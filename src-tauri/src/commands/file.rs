use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri::Runtime;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

impl FileFilter {
    pub fn to_filter_tuple(&self) -> (String, Vec<String>) {
        (self.name.clone(), self.extensions.clone())
    }
}

fn apply_file_filters<R: Runtime>(
    mut builder: FileDialogBuilder<R>,
    filters: &[FileFilter],
) -> FileDialogBuilder<R> {
    if filters.is_empty() {
        builder = builder.add_filter("All Files", &["*"]);
    } else {
        for filter in filters {
            let (name, extensions) = filter.to_filter_tuple();
            builder = builder.add_filter(
                &name,
                &extensions.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            );
        }
    }
    builder
}

fn handle_file_path(file_path: Option<FilePath>) -> Result<String, String> {
    match file_path {
        Some(path) => path
            .into_path()
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| format!("Invalid file path: {}", e)),
        None => Err("No file selected".to_string()),
    }
}

#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    title: String,
    default_name: String,
    filters: Vec<FileFilter>,
) -> Result<String, String> {
    let builder = app
        .dialog()
        .file()
        .set_title(&title)
        .set_file_name(&default_name);

    let builder = apply_file_filters(builder, &filters);

    let file_path = builder.blocking_save_file();

    handle_file_path(file_path)
}

#[tauri::command]
pub async fn open_file_dialog(
    app: AppHandle,
    title: String,
    filters: Vec<FileFilter>,
) -> Result<String, String> {
    let builder = app.dialog().file().set_title(&title);

    let builder = apply_file_filters(builder, &filters);

    let file_path = builder.blocking_pick_file();

    handle_file_path(file_path)
}

/// 校验用户选择的文件路径。
///
/// 设计决策：这些路径均来自原生文件对话框，即用户显式授权的位置
/// （导出字幕到「桌面 / 文档」等目录是产品的主流程），因此不再做目录白名单限制。
/// 仍然拦截两类真实风险：
/// 1. 非绝对路径（相对路径语义不确定，易被利用）；
/// 2. 包含 `..` 上级目录引用（路径遍历）。
/// 写入时额外要求父目录已存在，避免静默创建非预期目录。
fn validate_user_path(path: &str, require_existing_parent: bool) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(format!("仅支持绝对路径: {}", path));
    }

    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("路径中不允许包含上级目录引用: {}", path));
    }

    match candidate.file_name() {
        Some(name) if !name.is_empty() => {}
        _ => return Err(format!("路径缺少文件名: {}", path)),
    }

    if require_existing_parent {
        let parent = candidate
            .parent()
            .ok_or_else(|| format!("无法解析目标目录: {}", path))?;
        if !parent.exists() {
            return Err(format!("目标目录不存在: {}", parent.display()));
        }
    }

    Ok(candidate.to_path_buf())
}

#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = validate_user_path(&path, true)?;
    tokio::fs::write(&target, content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file {}: {}", path, e))
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    let target = validate_user_path(&path, false)?;
    tokio::fs::read_to_string(&target)
        .await
        .map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub async fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to get file info: {}", e))?;

    Ok(FileInfo {
        path,
        size: metadata.len(),
        is_directory: metadata.is_dir(),
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileInfo {
    pub path: String,
    pub size: u64,
    pub is_directory: bool,
}

#[cfg(test)]
mod tests {
    use super::validate_user_path;

    #[test]
    fn rejects_empty_path() {
        assert!(validate_user_path("   ", false).is_err());
    }

    #[test]
    fn rejects_relative_path() {
        let error = validate_user_path("subtitles/output.srt", true).unwrap_err();
        assert!(error.contains("绝对路径"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_parent_directory_traversal() {
        let path = format!("{}/../escape.srt", std::env::temp_dir().display());
        let error = validate_user_path(&path, false).unwrap_err();
        assert!(error.contains("上级目录"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_path_without_file_name() {
        assert!(validate_user_path("/", false).is_err());
    }

    #[test]
    fn accepts_user_selected_export_path_when_parent_exists() {
        // 导出到用户目录（如桌面）是主流程，必须放行
        let path = std::env::temp_dir().join("sublens_export.srt");
        let validated =
            validate_user_path(&path.to_string_lossy(), true).expect("should be allowed");
        assert_eq!(validated, path);
    }

    #[test]
    fn write_validation_requires_existing_parent_directory() {
        let missing = std::env::temp_dir()
            .join("sublens_definitely_missing_dir")
            .join("out.srt");
        let error = validate_user_path(&missing.to_string_lossy(), true).unwrap_err();
        assert!(
            error.contains("目标目录不存在"),
            "unexpected error: {error}"
        );

        // 读取路径不要求父目录存在（仅做语法校验）
        assert!(validate_user_path(&missing.to_string_lossy(), false).is_ok());
    }
}
