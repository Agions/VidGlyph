//! Rust-native OCR engine — replaces PaddleOCR Python dependency.
//!
//! Uses the `ort` crate with ONNX Runtime to run PaddleOCR PP-OCRv6
//! models (detection + recognition) entirely in Rust, with optional
//! GPU acceleration and internal LRU caching.
//!
//! ## Architecture
//!
//! ```text
//! Image ──→ Preprocess ──→ Detection Model ──→ Box Decoder ─┐
//!                                                            │
//!                  ┌─────────────────────────────────────────┘
//!                  ↓
//!             Crop + Resize + Normalize
//!                  │
//!                  ├──→ Recognition Model ──→ CTC Decode ──→ Text
//!                  └──→ Classify Model (opt) → Orientation fix
//!                                                      │
//!                                                  Result[]
//! ```
//!
//! ## Performance Features
//!
//! - **LRU Cache**: Frame hash → OCR result cache (configurable capacity)
//! - **Model Warmup**: Pre-warm ONNX sessions on startup
//! - **GPU Support**: Automatic CUDA/CPU provider selection
//! - **Concurrent Inference**: Detection + per-box recognition pipeline

pub mod cache;
pub mod postprocess;
pub mod preprocess;
pub mod session;
use crate::commands::types::{BBox, OCRResult};

use cache::OCR_CACHE;
use image::DynamicImage;
use image::GenericImageView;
use ndarray::Array;
use postprocess::{compute_confidence, decode_boxes, nms_boxes, simple_hash};
use preprocess::preprocess_detection;
use session::{DET_POOL, DET_SESSION, REC_POOL, REC_SESSION};

// Box expansion ratio for recognition crops.
const BOX_EXPAND_RATIO: f32 = 0.1;

// ─── Core engine ──────────────────────────────────────────────────────────────

/// The main Rust-native OCR engine.
pub struct OcrEngine;

impl OcrEngine {
    /// Run OCR on the given image.
    pub fn recognize(img: &DynamicImage, _lang: &str) -> Result<Vec<OCRResult>, String> {
        let hash = simple_hash(img);

        // Check cache
        {
            let mut cache = OCR_CACHE
                .lock()
                .map_err(|e| format!("{}: {e}", crate::commands::errors::CACHE_LOCK_POISONED))?;
            if let Some(cached) = cache.get(&hash) {
                tracing::debug!("OCR cache hit for hash 0x{:x}", hash);
                return Ok(cached.clone());
            }
        }

        // Run detection
        let (det_input, new_w, new_h) = preprocess_detection(img);
        let (img_w, img_h) = img.dimensions();

        let det_tensor = ort::value::TensorRef::from_array_view(&det_input)
            .map_err(|e| format!("Failed to create detection tensor: {e}"))?;

        let det_outputs_owned = DET_SESSION.run_owned(ort::inputs![det_tensor])?;

        // Get detection output
        let (_name, det_shape_vec, det_data) = det_outputs_owned
            .into_iter()
            .next()
            .ok_or_else(|| "No detection output".to_string())?;

        let det_owned: Array<f32, ndarray::IxDyn> =
            Array::from_shape_vec(ndarray::IxDyn(&det_shape_vec), det_data)
                .map_err(|e| format!("Failed to create detection array: {e}"))?;
        let det_shape = det_owned.shape().to_vec();
        let det_h = det_shape.get(2).copied().unwrap_or(1).max(1);
        let det_w = det_shape.get(3).copied().unwrap_or(1).max(1);

        let det_array = Array::from_shape_vec(
            ndarray::IxDyn(&[1, 1, det_h, det_w]),
            det_owned.iter().copied().collect(),
        )
        .map_err(|e| format!("Failed to reshape detection output: {e}"))?;

        // Decode boxes
        let raw_boxes = decode_boxes(
            &det_array,
            img_w as f32,
            img_h as f32,
            new_w as u32,
            new_h as u32,
        );
        let boxes = nms_boxes(&raw_boxes, 0.5);

        if boxes.is_empty() {
            tracing::debug!("No text regions detected in image");
            let empty = vec![];
            OCR_CACHE
                .lock()
                .map(|mut c| c.insert(hash, empty.clone()))
                .ok();
            return Ok(empty);
        }

        tracing::debug!("Detected {} text regions (after NMS)", boxes.len());

        // Run recognition for each box
        let _rec_session = &REC_SESSION;

        let mut results: Vec<OCRResult> = Vec::with_capacity(boxes.len());
        for &[x1, y1, x2, y2] in &boxes {
            let crop_x = (x1 as u32).saturating_sub((x1 * BOX_EXPAND_RATIO) as u32);
            let crop_y = (y1 as u32).saturating_sub((y1 * BOX_EXPAND_RATIO) as u32);
            let crop_w = ((x2 - x1) * (1.0 + 2.0 * BOX_EXPAND_RATIO)) as u32;
            let crop_h = ((y2 - y1) * (1.0 + 2.0 * BOX_EXPAND_RATIO)) as u32;

            let crop = img.crop_imm(
                crop_x.min(img_w.saturating_sub(1)),
                crop_y.min(img_h.saturating_sub(1)),
                crop_w.min(img_w.saturating_sub(crop_x)).max(1),
                crop_h.min(img_h.saturating_sub(crop_y)).max(1),
            );

            let rec_input = preprocess::preprocess_recognition(&crop);

            let rec_tensor = match ort::value::TensorRef::from_array_view(&rec_input) {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("Failed to create recognition tensor: {e}");
                    continue;
                }
            };

            let rec_outputs_owned = match REC_SESSION.run_owned(ort::inputs![rec_tensor]) {
                Ok(o) => o,
                Err(e) => {
                    tracing::warn!("Recognition inference failed for one box: {e}");
                    continue;
                }
            };

            let (_name, rec_shape_vec, rec_data) = match rec_outputs_owned.into_iter().next() {
                Some(v) => v,
                None => continue,
            };
            let rec_owned: Array<f32, ndarray::IxDyn> =
                match Array::from_shape_vec(ndarray::IxDyn(&rec_shape_vec), rec_data) {
                    Ok(a) => a,
                    Err(_) => continue,
                };
            let rec_shape = rec_owned.shape().to_vec();

            if rec_shape.len() < 3 {
                continue;
            }

            let timesteps = rec_shape[1];
            let vocab_size = rec_shape[2];

            let rec_reshaped = Array::from_shape_vec(
                ndarray::IxDyn(&[1, timesteps, vocab_size]),
                rec_owned.iter().copied().collect(),
            );

            let rec_array = match rec_reshaped {
                Ok(a) => a,
                Err(_) => continue,
            };

            let text = postprocess::ctc_decode(&rec_array);

            if !text.is_empty() {
                let confidence = compute_confidence(&rec_array);
                results.push(OCRResult {
                    text,
                    confidence,
                    bbox: BBox {
                        x: x1,
                        y: y1,
                        width: x2 - x1,
                        height: y2 - y1,
                    },
                });
            }
        }

        OCR_CACHE
            .lock()
            .map(|mut c| c.insert(hash, results.clone()))
            .ok();
        Ok(results)
    }

    /// Run OCR using pooled sessions for high concurrency.
    pub fn recognize_pooled(img: &DynamicImage, _lang: &str) -> Result<Vec<OCRResult>, String> {
        let hash = simple_hash(img);

        // Check cache
        {
            let mut cache = OCR_CACHE
                .lock()
                .map_err(|e| format!("{}: {e}", crate::commands::errors::CACHE_LOCK_POISONED))?;
            if let Some(cached) = cache.get(&hash) {
                tracing::debug!("OCR cache hit for hash 0x{:x}", hash);
                return Ok(cached.clone());
            }
        }

        // Run detection with pooled session
        let (det_input, new_w, new_h) = preprocess_detection(img);
        let (img_w, img_h) = img.dimensions();

        let det_tensor = ort::value::TensorRef::from_array_view(&det_input)
            .map_err(|e| format!("Failed to create detection tensor: {e}"))?;

        let mut det_pooled = DET_POOL.acquire()?;
        let det_outputs_owned = det_pooled.run_owned(ort::inputs![det_tensor])?;
        drop(det_pooled);

        // Get detection output
        let (_name, det_shape_vec, det_data) = det_outputs_owned
            .into_iter()
            .next()
            .ok_or_else(|| "No detection output".to_string())?;

        let det_owned: Array<f32, ndarray::IxDyn> =
            Array::from_shape_vec(ndarray::IxDyn(&det_shape_vec), det_data)
                .map_err(|e| format!("Failed to create detection array: {e}"))?;
        let det_shape = det_owned.shape().to_vec();
        let det_h = det_shape.get(2).copied().unwrap_or(1).max(1);
        let det_w = det_shape.get(3).copied().unwrap_or(1).max(1);

        let det_array = Array::from_shape_vec(
            ndarray::IxDyn(&[1, 1, det_h, det_w]),
            det_owned.iter().copied().collect(),
        )
        .map_err(|e| format!("Failed to reshape detection output: {e}"))?;

        // Decode boxes
        let raw_boxes = decode_boxes(
            &det_array,
            img_w as f32,
            img_h as f32,
            new_w as u32,
            new_h as u32,
        );
        let boxes = nms_boxes(&raw_boxes, 0.5);

        if boxes.is_empty() {
            let empty = vec![];
            OCR_CACHE
                .lock()
                .map(|mut c| c.insert(hash, empty.clone()))
                .ok();
            return Ok(empty);
        }

        let mut results: Vec<OCRResult> = Vec::with_capacity(boxes.len());
        let mut rec_pooled = REC_POOL.acquire()?;

        for &[x1, y1, x2, y2] in &boxes {
            let crop_x = (x1 as u32).saturating_sub((x1 * BOX_EXPAND_RATIO) as u32);
            let crop_y = (y1 as u32).saturating_sub((y1 * BOX_EXPAND_RATIO) as u32);
            let crop_w = ((x2 - x1) * (1.0 + 2.0 * BOX_EXPAND_RATIO)) as u32;
            let crop_h = ((y2 - y1) * (1.0 + 2.0 * BOX_EXPAND_RATIO)) as u32;

            let crop = img.crop_imm(
                crop_x.min(img_w.saturating_sub(1)),
                crop_y.min(img_h.saturating_sub(1)),
                crop_w.min(img_w.saturating_sub(crop_x)).max(1),
                crop_h.min(img_h.saturating_sub(crop_y)).max(1),
            );

            let rec_input = preprocess::preprocess_recognition(&crop);
            let rec_tensor = match ort::value::TensorRef::from_array_view(&rec_input) {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("Failed to create recognition tensor: {e}");
                    continue;
                }
            };

            let rec_outputs_owned = match rec_pooled.run_owned(ort::inputs![rec_tensor]) {
                Ok(o) => o,
                Err(e) => {
                    tracing::warn!("Recognition inference failed for one box: {e}");
                    continue;
                }
            };

            let (_name, rec_shape_vec, rec_data) = match rec_outputs_owned.into_iter().next() {
                Some(v) => v,
                None => continue,
            };
            let rec_owned: Array<f32, ndarray::IxDyn> =
                match Array::from_shape_vec(ndarray::IxDyn(&rec_shape_vec), rec_data) {
                    Ok(a) => a,
                    Err(_) => continue,
                };
            let rec_shape = rec_owned.shape().to_vec();

            if rec_shape.len() < 3 {
                continue;
            }

            let timesteps = rec_shape[1];
            let vocab_size = rec_shape[2];

            let rec_reshaped = Array::from_shape_vec(
                ndarray::IxDyn(&[1, timesteps, vocab_size]),
                rec_owned.iter().copied().collect(),
            );

            let rec_array = match rec_reshaped {
                Ok(a) => a,
                Err(_) => continue,
            };

            let text = postprocess::ctc_decode(&rec_array);
            let confidence = compute_confidence(&rec_array);

            if !text.is_empty() {
                results.push(OCRResult {
                    text,
                    confidence,
                    bbox: BBox {
                        x: x1,
                        y: y1,
                        width: x2 - x1,
                        height: y2 - y1,
                    },
                });
            }
        }

        OCR_CACHE
            .lock()
            .map(|mut c| c.insert(hash, results.clone()))
            .ok();
        Ok(results)
    }

    /// Warm up the ONNX sessions by loading the models.
    pub fn warmup() -> Result<(), String> {
        tracing::info!("Warming up OCR engine...");
        DET_SESSION.ensure_loaded()?;
        REC_SESSION.ensure_loaded()?;
        tracing::info!("OCR engine warmup complete");
        Ok(())
    }

    /// Get available ONNX Runtime execution provider names.
    pub fn available_providers() -> Vec<String> {
        // ort 2.0 doesn't expose available_providers() directly.
        // CUDA availability is checked via nvidia-smi in gpu.rs
        vec!["CPUExecutionProvider".to_string()]
    }

    /// Check if CUDA is available via nvidia-smi.
    pub fn has_cuda() -> bool {
        std::process::Command::new("nvidia-smi")
            .output()
            .ok()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbImage;

    fn test_image() -> DynamicImage {
        let mut img = RgbImage::new(100, 50);
        for p in img.pixels_mut() {
            *p = image::Rgb([255u8, 255, 255]);
        }
        for y in 10..20 {
            for x in 5..90 {
                img.put_pixel(x, y, image::Rgb([30, 30, 30]));
            }
        }
        DynamicImage::ImageRgb8(img)
    }

    #[test]
    fn test_preprocess_detection_shape() {
        let img = test_image();
        let (tensor, nw, nh) = preprocess_detection(&img);
        assert_eq!(tensor.shape(), &[1, 3, 960, 960]);
        assert!(nw > 0.0);
        assert!(nh > 0.0);
    }

    #[test]
    fn test_preprocess_recognition_shape() {
        let img = test_image().crop_imm(5, 10, 85, 10);
        let tensor = preprocess::preprocess_recognition(&img);
        let shape = tensor.shape();
        assert_eq!(shape[0], 1);
        assert_eq!(shape[1], 3);
        assert_eq!(shape[2], 48);
        assert!(shape[3] >= 8);
        assert!(shape[3] <= 3200);
    }

    #[test]
    fn test_ctc_decode_empty() {
        let arr = ndarray::Array::zeros(ndarray::IxDyn(&[1, 10, 100]));
        let text = postprocess::ctc_decode(&arr);
        assert_eq!(text, "");
    }

    #[test]
    fn test_simple_hash_deterministic() {
        let img = test_image();
        let h1 = postprocess::simple_hash(&img);
        let h2 = postprocess::simple_hash(&img);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_simple_hash_different() {
        let img1 = test_image();
        let mut img2 = RgbImage::new(100, 50);
        for p in img2.pixels_mut() {
            *p = image::Rgb([128, 128, 128]);
        }
        let h1 = postprocess::simple_hash(&img1);
        let h2 = postprocess::simple_hash(&DynamicImage::ImageRgb8(img2));
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_decode_boxes_empty() {
        let arr = ndarray::Array::zeros(ndarray::IxDyn(&[1, 1, 10, 10]));
        let boxes = postprocess::decode_boxes(&arr, 100.0, 50.0, 200, 100);
        assert!(boxes.is_empty());
    }

    #[test]
    fn test_decode_boxes_single() {
        let mut arr = ndarray::Array::zeros(ndarray::IxDyn(&[1, 1, 10, 10]));
        arr[[0, 0, 5, 5]] = 1.0;
        let boxes = postprocess::decode_boxes(&arr, 100.0, 50.0, 200, 100);
        assert_eq!(boxes.len(), 1);
    }

    #[test]
    fn test_nms_boxes_non_overlapping() {
        let boxes = vec![[10.0, 10.0, 50.0, 50.0], [100.0, 100.0, 150.0, 150.0]];
        let result = postprocess::nms_boxes(&boxes, 0.5);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_nms_boxes_overlapping() {
        let boxes = vec![[10.0, 10.0, 100.0, 100.0], [20.0, 20.0, 90.0, 90.0]];
        let result = postprocess::nms_boxes(&boxes, 0.5);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], [10.0, 10.0, 100.0, 100.0]);
    }

    #[test]
    fn test_lru_cache_basic() {
        let mut cache = cache::OcrCache::new(5);
        let key = 42u64;
        let val = vec![OCRResult {
            text: "hello".into(),
            confidence: 0.95,
            bbox: BBox {
                x: 0.0,
                y: 0.0,
                width: 10.0,
                height: 5.0,
            },
        }];
        assert!(cache.get(&key).is_none());
        cache.insert(key, val.clone());
        assert!(cache.get(&key).is_some());
    }

    #[test]
    fn test_lru_cache_eviction() {
        let mut cache = cache::OcrCache::new(3);
        for i in 0..5 {
            cache.insert(
                i,
                vec![OCRResult {
                    text: format!("item_{i}"),
                    confidence: 0.9,
                    bbox: BBox {
                        x: 0.0,
                        y: 0.0,
                        width: 1.0,
                        height: 1.0,
                    },
                }],
            );
        }
        assert!(cache.get(&0).is_none());
        assert!(cache.get(&1).is_none());
        assert!(cache.get(&2).is_some());
        assert!(cache.get(&3).is_some());
        assert!(cache.get(&4).is_some());
    }

    #[test]
    fn test_compute_confidence_all_zeros() {
        let arr = ndarray::Array::zeros(ndarray::IxDyn(&[1, 10, 100]));
        let conf = compute_confidence(&arr);
        assert_eq!(conf, 0.0);
    }
}
