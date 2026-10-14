use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::ffmpeg::{
    parse_duration_from_ffmpeg_output, parse_fps_from_fraction, parse_stream_info,
};
use super::utils::{run_command_with_timeout, uuid_v4, TempFileGuard};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoMetadata {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub fps: f64,
    pub total_frames: u64,
    pub codec: String,
}

#[tauri::command]
pub async fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {
    // Warn about paths with special characters that may cause issues
    if path.contains(|c: char| ['\'', '"', '$', '`', '\\'].contains(&c)) {
        tracing::warn!(
            "Video path contains shell-special characters which may cause issues: {}",
            path
        );
    }

    tracing::info!("Getting metadata for: {}", path);

    let path_obj = Path::new(&path);

    if !path_obj.exists() {
        return Err(format!(
            "{}: {}",
            crate::commands::errors::FILE_NOT_FOUND,
            path
        ));
    }

    // Try to use ffprobe for real metadata
    if let Ok(metadata) = get_video_metadata_ffprobe(&path).await {
        tracing::info!(
            "Got video metadata via ffprobe: {}x{} @ {} fps, {}s",
            metadata.width,
            metadata.height,
            metadata.fps,
            metadata.duration
        );
        return Ok(metadata);
    }

    // Fallback: try to get at least basic info via ffmpeg
    tracing::warn!("ffprobe not available, trying ffmpeg as fallback");
    if let Ok(metadata) = get_video_metadata_ffmpeg(&path).await {
        return Ok(metadata);
    }

    // Last resort: file-based estimation with video extension hint
    tracing::warn!("Using rough file-based estimation - results may be inaccurate");
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(meta) => {
            let file_size = meta.len();
            let extension = path_obj
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            // 根据扩展名和文件大小做更合理的估算
            let (bitrate_per_sec, default_fps, default_width, default_height) =
                match extension.as_str() {
                    "mp4" | "m4v" => (2_000_000.0, 30.0, 1920, 1080),
                    "mkv" => (3_000_000.0, 30.0, 1920, 1080),
                    "webm" => (1_500_000.0, 30.0, 1920, 1080),
                    "avi" => (2_500_000.0, 30.0, 1920, 1080),
                    "mov" => (2_000_000.0, 30.0, 1920, 1080),
                    "flv" => (1_000_000.0, 25.0, 1280, 720),
                    _ => (2_000_000.0, 30.0, 1920, 1080),
                };

            let estimated_duration = (file_size as f64 / bitrate_per_sec).max(1.0);
            let fps = default_fps;
            let total_frames = (estimated_duration * fps) as u64;

            VideoMetadata {
                path: path.clone(),
                width: default_width,
                height: default_height,
                duration: estimated_duration,
                fps,
                total_frames,
                codec: extension.clone(),
            }
        }
        Err(_) => {
            return Err(format!("Cannot read file metadata: {}", path));
        }
    };

    Ok(metadata)
}

/// Get video metadata using ffmpeg (async, fallback when ffprobe unavailable)
async fn get_video_metadata_ffmpeg(path: &str) -> Result<VideoMetadata, String> {
    let output = run_command_with_timeout(
        "ffmpeg",
        &["-i", path, "-f", "null", "-"],
        std::time::Duration::from_secs(30),
    )
    .await?;

    // ffmpeg outputs metadata to stderr
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse duration from ffmpeg output
    let duration = parse_duration_from_ffmpeg_output(&stderr);
    let (width, height, fps) = parse_stream_info(&stderr);

    if duration <= 0.0 {
        return Err("Could not determine video duration".to_string());
    }

    let total_frames = if fps > 0.0 {
        (duration * fps) as u64
    } else {
        0
    };

    Ok(VideoMetadata {
        path: path.to_string(),
        width,
        height,
        duration,
        fps,
        total_frames,
        codec: "unknown".to_string(),
    })
}

async fn get_video_metadata_ffprobe(path: &str) -> Result<VideoMetadata, String> {
    let output = run_command_with_timeout(
        "ffprobe",
        &[
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ],
        std::time::Duration::from_secs(30),
    )
    .await?;

    if !output.status.success() {
        return Err("ffprobe exited with error".to_string());
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    // Find video stream
    let video_stream = json["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"))
        .ok_or("No video stream found")?;

    let width = video_stream["width"].as_u64().unwrap_or(1920) as u32;
    let height = video_stream["height"].as_u64().unwrap_or(1080) as u32;

    // Parse frame rate (e.g., "30000/1001" -> ~29.97)
    let fps_str = video_stream["r_frame_rate"].as_str().unwrap_or("30/1");
    let fps = parse_fps_from_fraction(fps_str);

    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);

    let codec = video_stream["codec_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    let total_frames = if duration > 0.0 && fps > 0.0 {
        (duration * fps) as u64
    } else {
        video_stream["nb_frames"].as_u64().unwrap_or(0)
    };

    Ok(VideoMetadata {
        path: path.to_string(),
        width,
        height,
        duration,
        fps,
        total_frames,
        codec,
    })
}

#[tauri::command]
pub async fn extract_frame_at_time(path: String, timestamp_secs: f64) -> Result<String, String> {
    extract_frame_at_time_impl(&path, timestamp_secs, None).await
}

async fn extract_frame_at_time_impl(
    path: &str,
    timestamp_secs: f64,
    crop_filter: Option<&str>,
) -> Result<String, String> {
    // Canonicalize and validate the video path to prevent path traversal
    let canonical = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Invalid video path '{}': {}", path, e))?;

    if !canonical.is_file() {
        return Err(format!("Video path '{}' is not a valid file", path));
    }

    // 使用 UUID + 时间戳避免竞争条件
    let uuid = uuid_v4();
    let timestamp_ms = (timestamp_secs * 1000.0) as u64;
    let output_path =
        std::env::temp_dir().join(format!("sublens_frame_{}_{}.png", timestamp_ms, uuid));
    let _guard = TempFileGuard::new(output_path.clone()); // Auto-cleanup on function exit

    // Build ffmpeg arguments with security flags
    // -y: overwrite output without asking
    // -nostdin: disable interactive mode (avoids deadlock in CI/non-TTY)
    // 优化：使用 Vec<String> 避免 &format!() 临时值生命周期问题
    let ts_str = format!("{}", timestamp_secs);
    let output_path_str = output_path.to_string_lossy();
    let mut args: Vec<&str> = vec![
        "-y",
        "-nostdin",
        "-ss",
        ts_str.as_str(),
        "-i",
        path,
        "-vframes",
        "1",
        "-q:v",
        "2",
    ];

    // Add crop filter if specified
    if let Some(filter) = crop_filter {
        args.extend(["-vf", filter]);
    }

    args.push(output_path_str.as_ref());

    let output = run_command_with_timeout("ffmpeg", &args, std::time::Duration::from_secs(30))
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    // Read the image and convert to base64
    let img_data = tokio::fs::read(&output_path)
        .await
        .map_err(|e| format!("Failed to read extracted frame: {}", e))?;

    let base64_str = STANDARD.encode(&img_data);

    Ok(format!("data:image/png;base64,{}", base64_str))
}
