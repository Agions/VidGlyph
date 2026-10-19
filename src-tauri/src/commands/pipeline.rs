//! High-performance native video decoding and streaming OCR pipeline.
//!
//! Streams cropped video frames from hardware-accelerated FFmpeg directly
//! into ONNX OCR via memory pipes (zero disk I/O), performs temporal
//! subtitle clustering/smoothing, and emits real-time progress events.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use image::{DynamicImage, RgbImage};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::AsyncReadExt;

use crate::commands::ocr_engine::OcrEngine;
use crate::commands::types::SubtitleItem;
use crate::commands::utils::uuid_v4;
use crate::commands::video::get_video_metadata;

/// Global registry of running pipeline tasks for cancellation.
static RUNNING_TASKS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Normalized ROI (0.0 ~ 1.0).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedRoi {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Request parameters to start native video extraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePipelineRequest {
    pub task_id: Option<String>,
    pub video_path: String,
    pub roi: NormalizedRoi,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub sample_interval: Option<f64>,
    pub min_confidence: Option<f64>,
    pub language: Option<String>,
    pub enable_scene_skip: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineProgressPayload {
    pub task_id: String,
    pub current_time: f64,
    pub total_time: f64,
    pub percent: f64,
    pub frames_processed: usize,
    pub frames_skipped: usize,
    pub subtitles_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineSubtitlePayload {
    pub task_id: String,
    pub subtitle: SubtitleItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFinishedPayload {
    pub task_id: String,
    pub status: String, // "completed" | "cancelled" | "error"
    pub total_frames: usize,
    pub frames_processed: usize,
    pub frames_skipped: usize,
    pub subtitles_count: usize,
    pub elapsed_ms: u64,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOcrStatus {
    pub ready: bool,
    pub det_exists: bool,
    pub rec_exists: bool,
    pub model_dir: String,
}

/// Check if native ONNX OCR models exist and are ready.
#[tauri::command]
pub fn check_native_ocr_ready() -> NativeOcrStatus {
    let dir = crate::commands::ocr_engine::session::model_dir();
    let det_exists = dir.join("det.onnx").exists();
    let rec_exists = dir.join("rec.onnx").exists();
    NativeOcrStatus {
        ready: det_exists && rec_exists,
        det_exists,
        rec_exists,
        model_dir: dir.to_string_lossy().to_string(),
    }
}

/// Cancel a running native extraction task.
#[tauri::command]
pub fn cancel_native_pipeline(task_id: String) -> Result<(), String> {
    let lock = RUNNING_TASKS
        .lock()
        .map_err(|e| format!("Failed to lock task registry: {e}"))?;
    if let Some(cancel_flag) = lock.get(&task_id) {
        cancel_flag.store(true, Ordering::SeqCst);
        tracing::info!("Native pipeline task [{}] cancel requested", task_id);
    }
    Ok(())
}

/// Read the next token from a PPM P6 header stream.
async fn next_ppm_token<R: AsyncReadExt + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<String>> {
    let mut in_comment = false;
    let mut token = String::new();
    let mut buf = [0u8; 1];

    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            if token.is_empty() {
                return Ok(None);
            } else {
                return Ok(Some(token));
            }
        }
        let b = buf[0];
        if in_comment {
            if b == b'\n' {
                in_comment = false;
            }
            continue;
        }
        if b == b'#' {
            in_comment = true;
            continue;
        }
        if b.is_ascii_whitespace() {
            if !token.is_empty() {
                return Ok(Some(token));
            }
        } else {
            token.push(b as char);
        }
    }
}

/// Read a complete PPM P6 frame from an async stream.
async fn read_ppm_frame<R: AsyncReadExt + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<(u32, u32, Vec<u8>)>> {
    let magic = match next_ppm_token(reader).await? {
        Some(m) => m,
        None => return Ok(None),
    };
    if magic != "P6" {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Invalid PPM magic: {}", magic),
        ));
    }

    let w_str = next_ppm_token(reader).await?.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "Missing PPM width")
    })?;
    let h_str = next_ppm_token(reader).await?.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "Missing PPM height")
    })?;
    let maxval_str = next_ppm_token(reader).await?.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "Missing PPM maxval")
    })?;

    let width: u32 = w_str.parse().map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Invalid width: {e}"),
        )
    })?;
    let height: u32 = h_str.parse().map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Invalid height: {e}"),
        )
    })?;
    let _maxval: u32 = maxval_str.parse().map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Invalid maxval: {e}"),
        )
    })?;

    let data_len = (width as usize) * (height as usize) * 3;
    let mut data = vec![0u8; data_len];
    reader.read_exact(&mut data).await?;

    Ok(Some((width, height, data)))
}

/// Fast downsampled pixel difference between two frames.
fn compute_frame_diff(a: &RgbImage, b: &RgbImage) -> f64 {
    if a.dimensions() != b.dimensions() {
        return 100.0;
    }
    let (w, h) = a.dimensions();
    let total_pixels = (w * h) as f64;
    if total_pixels == 0.0 {
        return 0.0;
    }

    let mut sum_diff: u64 = 0;
    // Sample every 4th pixel for speed
    let step = 4;
    let mut sampled_count = 0;
    for y in (0..h).step_by(step) {
        for x in (0..w).step_by(step) {
            let p1 = a.get_pixel(x, y);
            let p2 = b.get_pixel(x, y);
            let diff = (p1[0] as i32 - p2[0] as i32).abs()
                + (p1[1] as i32 - p2[1] as i32).abs()
                + (p1[2] as i32 - p2[2] as i32).abs();
            sum_diff += diff as u64;
            sampled_count += 1;
        }
    }

    if sampled_count == 0 {
        return 0.0;
    }
    (sum_diff as f64) / (sampled_count as f64 * 3.0)
}

/// Calculate normalized Levenshtein edit distance similarity ratio between two subtitle strings.
fn text_similarity(s1: &str, s2: &str) -> f64 {
    let t1 = s1.trim();
    let t2 = s2.trim();
    if t1 == t2 {
        return 1.0;
    }
    if t1.is_empty() || t2.is_empty() {
        return 0.0;
    }

    // Direct substring inclusion optimization (handles partial recognition / progressive subtitles)
    if t1.contains(t2) || t2.contains(t1) {
        let shorter = t1.chars().count().min(t2.chars().count()) as f64;
        let longer = t1.chars().count().max(t2.chars().count()) as f64;
        if shorter / longer >= 0.65 {
            return (shorter / longer).max(0.85);
        }
    }

    let chars1: Vec<char> = t1.chars().collect();
    let chars2: Vec<char> = t2.chars().collect();
    let len1 = chars1.len();
    let len2 = chars2.len();

    // Two-row dynamic programming for space-efficient Levenshtein distance
    let mut prev_row: Vec<usize> = (0..=len2).collect();
    let mut curr_row: Vec<usize> = vec![0; len2 + 1];

    for (i, &c1) in chars1.iter().enumerate() {
        curr_row[0] = i + 1;
        for (j, &c2) in chars2.iter().enumerate() {
            let cost = if c1 == c2 { 0 } else { 1 };
            curr_row[j + 1] = (prev_row[j + 1] + 1)
                .min(curr_row[j] + 1)
                .min(prev_row[j] + cost);
        }
        prev_row.copy_from_slice(&curr_row);
    }

    let distance = prev_row[len2];
    let max_len = len1.max(len2);
    if max_len == 0 {
        1.0
    } else {
        1.0 - (distance as f64 / max_len as f64)
    }
}

struct PendingSubtitle {
    id: String,
    start_time: f64,
    end_time: f64,
    text: String,
    confidence: f64,
    occurrences: usize,
}

/// Start high-performance native extraction pipeline.
#[tauri::command]
pub async fn start_native_pipeline(
    app_handle: tauri::AppHandle,
    request: NativePipelineRequest,
) -> Result<String, String> {
    let task_id = request.task_id.unwrap_or_else(uuid_v4);
    let cancel_flag = Arc::new(AtomicBool::new(false));

    {
        let mut lock = RUNNING_TASKS
            .lock()
            .map_err(|e| format!("Failed to lock tasks: {e}"))?;
        lock.insert(task_id.clone(), cancel_flag.clone());
    }

    let task_id_clone = task_id.clone();
    let app_clone = app_handle.clone();

    tokio::spawn(async move {
        let start_instant = Instant::now();
        let mut frames_processed = 0usize;
        let mut frames_skipped = 0usize;
        let mut subtitles_count = 0usize;

        let res: Result<(), String> = async {
            // 1. Metadata resolution
            let meta = get_video_metadata(request.video_path.clone())
                .await
                .map_err(|e| format!("Failed to read video metadata: {e}"))?;

            let duration = meta.duration;
            let range_start = request.start_time.unwrap_or(0.0).max(0.0);
            let range_end = request.end_time.unwrap_or(duration).min(duration);
            let total_range = (range_end - range_start).max(0.1);
            let interval = request.sample_interval.unwrap_or(1.0).max(0.1);
            let min_conf = request.min_confidence.unwrap_or(60.0);
            let lang = request.language.unwrap_or_else(|| "ch".to_string());
            let enable_scene_skip = request.enable_scene_skip.unwrap_or(true);

            let crop_w = request.roi.width.clamp(0.01, 1.0);
            let crop_h = request.roi.height.clamp(0.01, 1.0);
            let crop_x = request.roi.x.clamp(0.0, 1.0 - crop_w);
            let crop_y = request.roi.y.clamp(0.0, 1.0 - crop_h);

            // 2. FFmpeg streaming command with hardware acceleration
            let filter = format!(
                "fps=1/{interval},crop=in_w*{crop_w:.4}:in_h*{crop_h:.4}:in_w*{crop_x:.4}:in_h*{crop_y:.4}"
            );

            let mut cmd = tokio::process::Command::new("ffmpeg");
            cmd.arg("-y")
                .arg("-nostdin")
                .arg("-hwaccel")
                .arg("auto")
                .arg("-ss")
                .arg(format!("{:.3}", range_start))
                .arg("-to")
                .arg(format!("{:.3}", range_end))
                .arg("-i")
                .arg(&request.video_path)
                .arg("-vf")
                .arg(&filter)
                .arg("-f")
                .arg("image2pipe")
                .arg("-vcodec")
                .arg("ppm")
                .arg("-")
                .stdout(Stdio::piped())
                .stderr(Stdio::null());

            let mut child = cmd
                .spawn()
                .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

            let mut stdout = child
                .stdout
                .take()
                .ok_or_else(|| "Failed to capture ffmpeg stdout".to_string())?;

            let mut prev_frame: Option<RgbImage> = None;
            let mut pending_sub: Option<PendingSubtitle> = None;
            let mut frame_index = 0usize;

            while let Some((w, h, data)) = read_ppm_frame(&mut stdout)
                .await
                .map_err(|e| format!("Error reading video frame stream: {e}"))?
            {
                if cancel_flag.load(Ordering::Relaxed) {
                    let _ = child.kill().await;
                    return Ok(());
                }

                let current_time = (range_start + (frame_index as f64) * interval).min(range_end);
                frame_index += 1;

                let rgb_img = match RgbImage::from_raw(w, h, data) {
                    Some(img) => img,
                    None => {
                        frames_skipped += 1;
                        continue;
                    }
                };

                // Check static frame difference to skip OCR when background hasn't changed
                let mut should_run_ocr = true;
                if enable_scene_skip {
                    if let Some(ref prev) = prev_frame {
                        let diff = compute_frame_diff(prev, &rgb_img);
                        // Very low difference means static scene
                        if diff < 2.5 {
                            should_run_ocr = false;
                        }
                    }
                }

                if !should_run_ocr {
                    frames_skipped += 1;
                    if let Some(ref mut sub) = pending_sub {
                        sub.end_time = (current_time + interval).min(range_end);
                    }
                } else {
                    let dyn_img = DynamicImage::ImageRgb8(rgb_img.clone());
                    let ocr_items = match OcrEngine::recognize(&dyn_img, &lang) {
                        Ok(items) => items,
                        Err(e) => {
                            tracing::warn!("OCR inference frame error: {e}");
                            vec![]
                        }
                    };

                    let kept: Vec<_> = ocr_items
                        .into_iter()
                        .filter(|item| (item.confidence as f64 * 100.0) >= min_conf || (item.confidence as f64) >= min_conf)
                        .collect();

                    if !kept.is_empty() {
                        frames_processed += 1;
                        let text = kept
                            .iter()
                            .map(|i| i.text.trim())
                            .collect::<Vec<_>>()
                            .join(" ");
                        let avg_conf = (kept.iter().map(|i| i.confidence as f64).sum::<f64>()
                            / kept.len() as f64)
                            .max(min_conf);

                        if let Some(mut existing) = pending_sub.take() {
                            let sim = text_similarity(&existing.text, &text);
                            if sim >= 0.70 {
                                // Extend current subtitle
                                existing.end_time = (current_time + interval).min(range_end);
                                existing.confidence = (existing.confidence * existing.occurrences as f64
                                    + avg_conf)
                                    / (existing.occurrences + 1) as f64;
                                existing.occurrences += 1;
                                // Prefer longer text if similarity is high
                                if text.chars().count() > existing.text.chars().count() {
                                    existing.text = text;
                                }
                                pending_sub = Some(existing);
                            } else {
                                // Flush previous subtitle and emit event
                                subtitles_count += 1;
                                let item = SubtitleItem {
                                    index: subtitles_count,
                                    id: existing.id,
                                    start_time: existing.start_time,
                                    end_time: existing.end_time,
                                    text: existing.text,
                                    confidence: existing.confidence,
                                    language: lang.clone(),
                                    start_frame: 0,
                                    end_frame: 0,
                                };
                                let _ = app_clone.emit(
                                    "vidglyph://pipeline-subtitle",
                                    PipelineSubtitlePayload {
                                        task_id: task_id_clone.clone(),
                                        subtitle: item,
                                    },
                                );

                                // Start new subtitle
                                pending_sub = Some(PendingSubtitle {
                                    id: uuid_v4(),
                                    start_time: current_time,
                                    end_time: (current_time + interval).min(range_end),
                                    text,
                                    confidence: avg_conf,
                                    occurrences: 1,
                                });
                            }
                        } else {
                            // Start new subtitle
                            pending_sub = Some(PendingSubtitle {
                                id: uuid_v4(),
                                start_time: current_time,
                                end_time: (current_time + interval).min(range_end),
                                text,
                                confidence: avg_conf,
                                occurrences: 1,
                            });
                        }
                    } else {
                        frames_skipped += 1;
                        if let Some(existing) = pending_sub.take() {
                            subtitles_count += 1;
                            let item = SubtitleItem {
                                index: subtitles_count,
                                id: existing.id,
                                start_time: existing.start_time,
                                end_time: existing.end_time,
                                text: existing.text,
                                confidence: existing.confidence,
                                language: lang.clone(),
                                start_frame: 0,
                                end_frame: 0,
                            };
                            let _ = app_clone.emit(
                                "vidglyph://pipeline-subtitle",
                                PipelineSubtitlePayload {
                                    task_id: task_id_clone.clone(),
                                    subtitle: item,
                                },
                            );
                        }
                    }
                }

                prev_frame = Some(rgb_img);

                // Emit progress event
                let progress_pct = (((current_time - range_start) / total_range) * 100.0).clamp(0.0, 100.0);
                let _ = app_clone.emit(
                    "vidglyph://pipeline-progress",
                    PipelineProgressPayload {
                        task_id: task_id_clone.clone(),
                        current_time,
                        total_time: range_end,
                        percent: progress_pct,
                        frames_processed,
                        frames_skipped,
                        subtitles_count,
                    },
                );
            }

            // Flush final pending subtitle if any
            if let Some(existing) = pending_sub.take() {
                subtitles_count += 1;
                let item = SubtitleItem {
                    index: subtitles_count,
                    id: existing.id,
                    start_time: existing.start_time,
                    end_time: existing.end_time,
                    text: existing.text,
                    confidence: existing.confidence,
                    language: lang.clone(),
                    start_frame: 0,
                    end_frame: 0,
                };
                let _ = app_clone.emit(
                    "vidglyph://pipeline-subtitle",
                    PipelineSubtitlePayload {
                        task_id: task_id_clone.clone(),
                        subtitle: item,
                    },
                );
            }

            let _ = child.wait().await;
            Ok(())
        }
        .await;

        let is_cancelled = cancel_flag.load(Ordering::SeqCst);
        let status = if is_cancelled {
            "cancelled".to_string()
        } else if let Err(ref e) = res {
            tracing::error!("Native pipeline failed: {e}");
            "error".to_string()
        } else {
            "completed".to_string()
        };

        let err_msg = res.err();
        let elapsed = start_instant.elapsed().as_millis() as u64;

        let _ = app_clone.emit(
            "vidglyph://pipeline-finished",
            PipelineFinishedPayload {
                task_id: task_id_clone.clone(),
                status,
                total_frames: frames_processed + frames_skipped,
                frames_processed,
                frames_skipped,
                subtitles_count,
                elapsed_ms: elapsed,
                error_message: err_msg,
            },
        );

        if let Ok(mut lock) = RUNNING_TASKS.lock() {
            lock.remove(&task_id_clone);
        }
    });

    Ok(task_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_text_similarity() {
        assert_eq!(text_similarity("你好世界", "你好世界"), 1.0);
        assert!(text_similarity("你好世界", "你好世界啊") >= 0.8);
        assert_eq!(text_similarity("", "abc"), 0.0);
        assert_eq!(text_similarity("abc", "def"), 0.0);
    }

    #[test]
    fn test_compute_frame_diff_identical() {
        let img1 = RgbImage::new(10, 10);
        let img2 = RgbImage::new(10, 10);
        assert_eq!(compute_frame_diff(&img1, &img2), 0.0);
    }

    #[test]
    fn test_compute_frame_diff_different() {
        let mut img1 = RgbImage::new(10, 10);
        let img2 = RgbImage::new(10, 10);
        for p in img1.pixels_mut() {
            *p = image::Rgb([255, 255, 255]);
        }
        let diff = compute_frame_diff(&img1, &img2);
        assert!(diff > 80.0);
    }

    #[tokio::test]
    async fn test_read_ppm_frame_valid() {
        let data = b"P6\n2 2\n255\n\x00\x00\x00\xff\xff\xff\x11\x22\x33\x44\x55\x66";
        let mut cursor = std::io::Cursor::new(data);
        let frame = read_ppm_frame(&mut cursor).await.unwrap();
        assert!(frame.is_some());
        let (w, h, bytes) = frame.unwrap();
        assert_eq!(w, 2);
        assert_eq!(h, 2);
        assert_eq!(bytes.len(), 12);
        assert_eq!(bytes[0..3], [0, 0, 0]);
        assert_eq!(bytes[3..6], [255, 255, 255]);
    }

    #[tokio::test]
    async fn test_read_ppm_frame_eof() {
        let data = b"";
        let mut cursor = std::io::Cursor::new(data);
        let frame = read_ppm_frame(&mut cursor).await.unwrap();
        assert!(frame.is_none());
    }
}
