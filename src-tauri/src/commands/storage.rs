//! SQLite WAL persistence layer and .vidglyph project bundle management.
//!
//! Provides transactional storage for projects, subtitles, and batch tasks
//! using SQLite with WAL (Write-Ahead Logging) mode, with support for
//! importing/exporting standalone `.vidglyph` project packages.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::commands::utils::uuid_v4;

static DB_INIT_LOCK: Mutex<()> = Mutex::new(());

/// Model representing a project in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub video_path: String,
    pub video_hash: Option<String>,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub roi_json: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Model representing a subtitle item in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleRecord {
    pub id: String,
    pub project_id: String,
    pub start_time_ms: u64,
    pub end_time_ms: u64,
    pub text_raw: String,
    pub text_corrected: Option<String>,
    pub confidence: f64,
    pub bbox_json: Option<String>,
    pub is_reviewed: bool,
    pub created_at: u64,
}

/// Model representing a batch task queue item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTaskRecord {
    pub id: String,
    pub project_id: Option<String>,
    pub video_path: String,
    pub status: String,
    pub progress: f64,
    pub config_json: String,
    pub error_msg: Option<String>,
    pub created_at: u64,
    pub finished_at: Option<u64>,
}

/// Complete project detail with its subtitle collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: ProjectRecord,
    pub subtitles: Vec<SubtitleRecord>,
}

/// VidGlyph project bundle payload (.vidglyph package format).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VidGlyphBundle {
    pub format_version: String,
    pub exported_at: u64,
    pub project: ProjectRecord,
    pub subtitles: Vec<SubtitleRecord>,
}

/// Resolve the default application SQLite database file path.
pub fn get_app_db_path() -> PathBuf {
    let base = if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.agions.vidglyph.desktop")
    } else {
        std::env::temp_dir().join("com.agions.vidglyph.desktop")
    };
    if std::fs::create_dir_all(&base).is_err() {
        let fallback = std::env::temp_dir().join("com.agions.vidglyph.desktop");
        let _ = std::fs::create_dir_all(&fallback);
        return fallback.join("vidglyph.db");
    }
    base.join("vidglyph.db")
}

/// Execute a SQL statement on the target database path.
fn execute_sql(db_path: &Path, sql: &str) -> Result<String, String> {
    let output = Command::new("sqlite3")
        .arg(db_path)
        .arg(sql)
        .output()
        .map_err(|e| format!("Failed to execute sqlite3: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SQLite error: {err}"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Execute a SQL query and parse result as JSON array.
fn query_json<T: for<'de> Deserialize<'de>>(db_path: &Path, sql: &str) -> Result<Vec<T>, String> {
    let output = Command::new("sqlite3")
        .arg("-json")
        .arg(db_path)
        .arg(sql)
        .output()
        .map_err(|e| format!("Failed to query sqlite3: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SQLite query error: {err}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "[]" {
        return Ok(Vec::new());
    }

    serde_json::from_str(&stdout).map_err(|e| format!("JSON deserialize error: {e} in '{stdout}'"))
}

/// Initialize database tables and enable WAL mode.
pub fn ensure_db_initialized(db_path: &Path) -> Result<(), String> {
    let _guard = DB_INIT_LOCK.lock().map_err(|e| e.to_string())?;

    let init_sql = r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            video_path TEXT NOT NULL,
            video_hash TEXT,
            duration_ms INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            fps REAL NOT NULL,
            roi_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subtitles (
            id TEXT PRIMARY KEY NOT NULL,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            start_time_ms INTEGER NOT NULL,
            end_time_ms INTEGER NOT NULL,
            text_raw TEXT NOT NULL,
            text_corrected TEXT,
            confidence REAL NOT NULL,
            bbox_json TEXT,
            is_reviewed INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_subs_project_time ON subtitles(project_id, start_time_ms);

        CREATE TABLE IF NOT EXISTS batch_tasks (
            id TEXT PRIMARY KEY NOT NULL,
            project_id TEXT,
            video_path TEXT NOT NULL,
            status TEXT NOT NULL,
            progress REAL DEFAULT 0.0,
            config_json TEXT NOT NULL,
            error_msg TEXT,
            created_at INTEGER NOT NULL,
            finished_at INTEGER
        );
    "#;

    execute_sql(db_path, init_sql)?;
    Ok(())
}

fn sql_escape(s: &str) -> String {
    s.replace('\'', "''")
}

/// Save a project and replace its subtitle collection atomically.
#[tauri::command]
pub fn db_save_project(
    project: ProjectRecord,
    subtitles: Vec<SubtitleRecord>,
) -> Result<String, String> {
    let db_path = get_app_db_path();
    ensure_db_initialized(&db_path)?;

    let mut sql = String::new();
    sql.push_str("BEGIN TRANSACTION;\n");

    // Upsert project
    sql.push_str(&format!(
        r#"INSERT INTO projects (id, name, video_path, video_hash, duration_ms, width, height, fps, roi_json, created_at, updated_at)
           VALUES ('{id}', '{name}', '{video_path}', {video_hash}, {duration_ms}, {width}, {height}, {fps}, '{roi_json}', {created_at}, {updated_at})
           ON CONFLICT(id) DO UPDATE SET
               name=excluded.name,
               video_path=excluded.video_path,
               video_hash=excluded.video_hash,
               duration_ms=excluded.duration_ms,
               width=excluded.width,
               height=excluded.height,
               fps=excluded.fps,
               roi_json=excluded.roi_json,
               updated_at=excluded.updated_at;
        "#,
        id = sql_escape(&project.id),
        name = sql_escape(&project.name),
        video_path = sql_escape(&project.video_path),
        video_hash = project
            .video_hash
            .as_ref()
            .map(|h| format!("'{}'", sql_escape(h)))
            .unwrap_or_else(|| "NULL".to_string()),
        duration_ms = project.duration_ms,
        width = project.width,
        height = project.height,
        fps = project.fps,
        roi_json = sql_escape(&project.roi_json),
        created_at = project.created_at,
        updated_at = project.updated_at,
    ));

    // Delete existing subtitles for this project
    sql.push_str(&format!(
        "DELETE FROM subtitles WHERE project_id = '{}';\n",
        sql_escape(&project.id)
    ));

    // Insert new subtitles
    for sub in &subtitles {
        sql.push_str(&format!(
            r#"INSERT INTO subtitles (id, project_id, start_time_ms, end_time_ms, text_raw, text_corrected, confidence, bbox_json, is_reviewed, created_at)
               VALUES ('{id}', '{project_id}', {start_ms}, {end_ms}, '{text_raw}', {text_corr}, {conf}, {bbox}, {reviewed}, {created_at});
            "#,
            id = sql_escape(&sub.id),
            project_id = sql_escape(&sub.project_id),
            start_ms = sub.start_time_ms,
            end_ms = sub.end_time_ms,
            text_raw = sql_escape(&sub.text_raw),
            text_corr = sub
                .text_corrected
                .as_ref()
                .map(|t| format!("'{}'", sql_escape(t)))
                .unwrap_or_else(|| "NULL".to_string()),
            conf = sub.confidence,
            bbox = sub
                .bbox_json
                .as_ref()
                .map(|b| format!("'{}'", sql_escape(b)))
                .unwrap_or_else(|| "NULL".to_string()),
            reviewed = if sub.is_reviewed { 1 } else { 0 },
            created_at = sub.created_at,
        ));
    }

    sql.push_str("COMMIT;\n");

    execute_sql(&db_path, &sql)?;
    tracing::info!(
        "Saved project [{}] with {} subtitles",
        project.id,
        subtitles.len()
    );
    Ok(project.id)
}

/// Internal helper to map flat row from SQLite json to ProjectRecord
#[derive(Deserialize)]
struct RawProjectRow {
    id: String,
    name: String,
    video_path: String,
    video_hash: Option<String>,
    duration_ms: u64,
    width: u32,
    height: u32,
    fps: f64,
    roi_json: String,
    created_at: u64,
    updated_at: u64,
}

#[derive(Deserialize)]
struct RawSubtitleRow {
    id: String,
    project_id: String,
    start_time_ms: u64,
    end_time_ms: u64,
    text_raw: String,
    text_corrected: Option<String>,
    confidence: f64,
    bbox_json: Option<String>,
    is_reviewed: i32,
    created_at: u64,
}

/// Load a project with all of its subtitles.
#[tauri::command]
pub fn db_load_project(project_id: String) -> Result<Option<ProjectDetail>, String> {
    let db_path = get_app_db_path();
    ensure_db_initialized(&db_path)?;

    let proj_sql = format!(
        "SELECT * FROM projects WHERE id = '{}' LIMIT 1;",
        sql_escape(&project_id)
    );
    let proj_rows: Vec<RawProjectRow> = query_json(&db_path, &proj_sql)?;
    let raw_proj = match proj_rows.into_iter().next() {
        Some(p) => p,
        None => return Ok(None),
    };

    let project = ProjectRecord {
        id: raw_proj.id,
        name: raw_proj.name,
        video_path: raw_proj.video_path,
        video_hash: raw_proj.video_hash,
        duration_ms: raw_proj.duration_ms,
        width: raw_proj.width,
        height: raw_proj.height,
        fps: raw_proj.fps,
        roi_json: raw_proj.roi_json,
        created_at: raw_proj.created_at,
        updated_at: raw_proj.updated_at,
    };

    let sub_sql = format!(
        "SELECT * FROM subtitles WHERE project_id = '{}' ORDER BY start_time_ms ASC;",
        sql_escape(&project_id)
    );
    let sub_rows: Vec<RawSubtitleRow> = query_json(&db_path, &sub_sql)?;

    let subtitles = sub_rows
        .into_iter()
        .map(|s| SubtitleRecord {
            id: s.id,
            project_id: s.project_id,
            start_time_ms: s.start_time_ms,
            end_time_ms: s.end_time_ms,
            text_raw: s.text_raw,
            text_corrected: s.text_corrected,
            confidence: s.confidence,
            bbox_json: s.bbox_json,
            is_reviewed: s.is_reviewed != 0,
            created_at: s.created_at,
        })
        .collect();

    Ok(Some(ProjectDetail { project, subtitles }))
}

/// List all saved projects ordered by updated time descending.
#[tauri::command]
pub fn db_list_projects() -> Result<Vec<ProjectRecord>, String> {
    let db_path = get_app_db_path();
    ensure_db_initialized(&db_path)?;

    let sql = "SELECT * FROM projects ORDER BY updated_at DESC;";
    let rows: Vec<RawProjectRow> = query_json(&db_path, sql)?;

    let projects = rows
        .into_iter()
        .map(|p| ProjectRecord {
            id: p.id,
            name: p.name,
            video_path: p.video_path,
            video_hash: p.video_hash,
            duration_ms: p.duration_ms,
            width: p.width,
            height: p.height,
            fps: p.fps,
            roi_json: p.roi_json,
            created_at: p.created_at,
            updated_at: p.updated_at,
        })
        .collect();

    Ok(projects)
}

/// Delete a project and cascade delete all its subtitles.
#[tauri::command]
pub fn db_delete_project(project_id: String) -> Result<(), String> {
    let db_path = get_app_db_path();
    ensure_db_initialized(&db_path)?;

    let sql = format!(
        r#"
        BEGIN TRANSACTION;
        DELETE FROM subtitles WHERE project_id = '{id}';
        DELETE FROM projects WHERE id = '{id}';
        COMMIT;
        "#,
        id = sql_escape(&project_id)
    );
    execute_sql(&db_path, &sql)?;
    tracing::info!("Deleted project [{}]", project_id);
    Ok(())
}

/// Save or update a batch task item in the queue.
#[tauri::command]
pub fn db_save_batch_task(task: BatchTaskRecord) -> Result<(), String> {
    let db_path = get_app_db_path();
    ensure_db_initialized(&db_path)?;

    let sql = format!(
        r#"INSERT INTO batch_tasks (id, project_id, video_path, status, progress, config_json, error_msg, created_at, finished_at)
           VALUES ('{id}', {proj_id}, '{video_path}', '{status}', {progress}, '{config_json}', {error_msg}, {created_at}, {finished_at})
           ON CONFLICT(id) DO UPDATE SET
               status=excluded.status,
               progress=excluded.progress,
               error_msg=excluded.error_msg,
               finished_at=excluded.finished_at;
        "#,
        id = sql_escape(&task.id),
        proj_id = task
            .project_id
            .as_ref()
            .map(|p| format!("'{}'", sql_escape(p)))
            .unwrap_or_else(|| "NULL".to_string()),
        video_path = sql_escape(&task.video_path),
        status = sql_escape(&task.status),
        progress = task.progress,
        config_json = sql_escape(&task.config_json),
        error_msg = task
            .error_msg
            .as_ref()
            .map(|e| format!("'{}'", sql_escape(e)))
            .unwrap_or_else(|| "NULL".to_string()),
        created_at = task.created_at,
        finished_at = task
            .finished_at
            .map(|f| f.to_string())
            .unwrap_or_else(|| "NULL".to_string()),
    );

    execute_sql(&db_path, &sql)?;
    Ok(())
}

#[derive(Deserialize)]
struct RawBatchTaskRow {
    id: String,
    project_id: Option<String>,
    video_path: String,
    status: String,
    progress: f64,
    config_json: String,
    error_msg: Option<String>,
    created_at: u64,
    finished_at: Option<u64>,
}

/// List all batch tasks ordered by created time descending.
#[tauri::command]
pub fn db_list_batch_tasks() -> Result<Vec<BatchTaskRecord>, String> {
    let db_path = get_app_db_path();
    ensure_db_initialized(&db_path)?;

    let sql = "SELECT * FROM batch_tasks ORDER BY created_at DESC;";
    let rows: Vec<RawBatchTaskRow> = query_json(&db_path, sql)?;

    let tasks = rows
        .into_iter()
        .map(|t| BatchTaskRecord {
            id: t.id,
            project_id: t.project_id,
            video_path: t.video_path,
            status: t.status,
            progress: t.progress,
            config_json: t.config_json,
            error_msg: t.error_msg,
            created_at: t.created_at,
            finished_at: t.finished_at,
        })
        .collect();

    Ok(tasks)
}

/// Export a project as a standalone `.vidglyph` bundle file.
#[tauri::command]
pub fn export_project_bundle(project_id: String, output_path: String) -> Result<String, String> {
    let detail = db_load_project(project_id)?.ok_or_else(|| "Project not found".to_string())?;

    let bundle = VidGlyphBundle {
        format_version: "2.0".to_string(),
        exported_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        project: detail.project,
        subtitles: detail.subtitles,
    };

    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| format!("Failed to serialize bundle: {e}"))?;

    let path = Path::new(&output_path);
    std::fs::write(path, json.as_bytes())
        .map_err(|e| format!("Failed to write bundle file: {e}"))?;

    tracing::info!("Exported project bundle to {}", output_path);
    Ok(output_path)
}

/// Import a `.vidglyph` bundle file into the database.
#[tauri::command]
pub fn import_project_bundle(bundle_path: String) -> Result<ProjectDetail, String> {
    let content = std::fs::read_to_string(&bundle_path)
        .map_err(|e| format!("Failed to read bundle file: {e}"))?;

    let mut bundle: VidGlyphBundle = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid VidGlyph bundle format: {e}"))?;

    // Generate new ID if already exists to avoid accidental collision
    let new_project_id = uuid_v4();
    bundle.project.id = new_project_id.clone();
    for sub in &mut bundle.subtitles {
        sub.id = uuid_v4();
        sub.project_id = new_project_id.clone();
    }

    db_save_project(bundle.project.clone(), bundle.subtitles.clone())?;

    Ok(ProjectDetail {
        project: bundle.project,
        subtitles: bundle.subtitles,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_crud_lifecycle() {
        let temp_dir = std::env::temp_dir();
        let test_db = temp_dir.join(format!("vidglyph_test_{}.db", uuid_v4()));
        let _ = std::fs::remove_file(&test_db);

        ensure_db_initialized(&test_db).expect("DB init failed");

        let project_id = uuid_v4();
        let project = ProjectRecord {
            id: project_id.clone(),
            name: "Test Project 1".to_string(),
            video_path: "/path/to/movie.mp4".to_string(),
            video_hash: Some("hash123".to_string()),
            duration_ms: 60000,
            width: 1920,
            height: 1080,
            fps: 30.0,
            roi_json: "{}".to_string(),
            created_at: 1000,
            updated_at: 1000,
        };

        let sub1 = SubtitleRecord {
            id: uuid_v4(),
            project_id: project_id.clone(),
            start_time_ms: 0,
            end_time_ms: 2000,
            text_raw: "Hello world".to_string(),
            text_corrected: Some("Hello, world!".to_string()),
            confidence: 95.0,
            bbox_json: None,
            is_reviewed: true,
            created_at: 1000,
        };

        // Use custom DB by calling execute_sql directly for test isolation
        let mut sql = String::new();
        sql.push_str("BEGIN TRANSACTION;\n");
        sql.push_str(&format!(
            "INSERT INTO projects VALUES ('{}', '{}', '{}', '{}', {}, {}, {}, {}, '{}', {}, {});\n",
            project.id,
            project.name,
            project.video_path,
            "hash123",
            project.duration_ms,
            project.width,
            project.height,
            project.fps,
            project.roi_json,
            project.created_at,
            project.updated_at
        ));
        sql.push_str(&format!(
            "INSERT INTO subtitles VALUES ('{}', '{}', {}, {}, '{}', '{}', {}, NULL, 1, {});\n",
            sub1.id,
            sub1.project_id,
            sub1.start_time_ms,
            sub1.end_time_ms,
            sub1.text_raw,
            "Hello, world!",
            sub1.confidence,
            sub1.created_at
        ));
        sql.push_str("COMMIT;\n");
        execute_sql(&test_db, &sql).expect("Insert failed");

        let loaded: Vec<RawProjectRow> = query_json(
            &test_db,
            &format!("SELECT * FROM projects WHERE id='{project_id}'"),
        )
        .expect("Query failed");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "Test Project 1");

        let loaded_subs: Vec<RawSubtitleRow> = query_json(
            &test_db,
            &format!("SELECT * FROM subtitles WHERE project_id='{project_id}'"),
        )
        .expect("Query subs failed");
        assert_eq!(loaded_subs.len(), 1);
        assert_eq!(loaded_subs[0].text_raw, "Hello world");

        let _ = std::fs::remove_file(&test_db);
    }
}
