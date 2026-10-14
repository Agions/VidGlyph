//! Shared utility functions used across multiple Rust modules.
//!
//! Centralising these helpers eliminates copy-paste duplication between
//! `commands/auto_roi.rs`, `commands/scene.rs`, and `tests/standalone_tests.rs`.

pub use crate::commands::utils::shared_core::{
    horizontal_projection, parse_pts_times, sobel_edges_raw,
};

/// Fill normalised pixel values for all channels of a single pixel position.
///
/// This eliminates the duplicated normalisation loop in
/// `ocr_engine/preprocess.rs` (detection + recognition paths).
pub fn fill_pixel_normalised(
    tensor: &mut ndarray::Array<f32, ndarray::IxDyn>,
    x: u32,
    y: u32,
    pixel: &image::Rgba<u8>,
    mean: [f32; 3],
    std: [f32; 3],
) {
    let x = x as usize;
    let y = y as usize;
    let r = pixel[0] as f32 / 255.0;
    let g = pixel[1] as f32 / 255.0;
    let b = pixel[2] as f32 / 255.0;

    tensor[[0, 0, y, x]] = (r - mean[0]) / std[0];
    tensor[[0, 1, y, x]] = (g - mean[1]) / std[1];
    tensor[[0, 2, y, x]] = (b - mean[2]) / std[2];
}
