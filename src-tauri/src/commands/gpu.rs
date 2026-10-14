//! GPU capability detection for SubLens.
//!
//! Uses ONNX Runtime's provider enumeration to detect CUDA/TensorRT
//! availability — no Python dependency needed.
//!
//! ## Architecture
//!
//! ```text
//! check_gpu_capability() → ort::available_providers() → GPUCapability
//! ```

use serde::{Deserialize, Serialize};

/// GPU capability information from ONNX Runtime providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GPUCapability {
    /// Whether CUDA GPU is available (via ONNX Runtime provider)
    pub available: bool,
    /// Number of GPU devices (detected via CUDA/TensorRT provider)
    pub device_count: Option<u32>,
    /// Total GPU memory in bytes (requires nvidia-smi at runtime)
    pub memory_total: Option<u64>,
    /// CUDA version string (from ONNX Runtime CUDA provider)
    pub cuda_version: Option<String>,
}

/// Parse the CUDA provider info string for version information.
///
/// ONNX Runtime reports CUDA providers like "CUDAExecutionProvider (12.4)".
/// We extract the version number if present.
fn parse_cuda_version(providers: &[String]) -> Option<String> {
    for p in providers {
        if p.contains("CUDA") {
            // Extract version from e.g. "CUDAExecutionProvider (12.4)"
            if let Some(start) = p.find('(') {
                if let Some(end) = p.find(')') {
                    let version = &p[start + 1..end];
                    if !version.is_empty() {
                        return Some(version.trim().to_string());
                    }
                }
            }
            // Fallback: return the provider name itself
            return Some(p.clone());
        }
    }
    None
}

/// Count CUDA devices via `nvidia-smi` query (purely as a subprocess check,
/// no Python dependency).
fn count_cuda_devices_via_nvidia_smi() -> Option<u32> {
    let output = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=count", "--format=csv,noheader"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.trim().parse::<u32>().ok()
}

/// Query total GPU memory via `nvidia-smi`.
fn query_gpu_memory_via_nvidia_smi() -> Option<u64> {
    let output = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // nvidia-smi returns memory in MiB
    let mib: u64 = stdout.trim().parse().ok()?;
    Some(mib * 1024 * 1024) // Convert to bytes
}

/// Check GPU capability via ONNX Runtime providers and nvidia-smi.
///
/// Pure Rust — no Python, no PaddlePaddle, no pynvml.
///
/// Returns a `GPUCapability` with:
/// - `available`: true if CUDA or TensorRT provider is registered
/// - `device_count`: from nvidia-smi (if available)
/// - `memory_total`: from nvidia-smi (if available)
/// - `cuda_version`: from the CUDA provider info string
#[tauri::command]
pub async fn check_gpu_capability() -> GPUCapability {
    let providers = super::ocr_engine::OcrEngine::available_providers();
    let has_cuda = super::ocr_engine::OcrEngine::has_cuda();

    tracing::debug!(
        "GPU detection: ONNX providers={:?}, has_cuda={}",
        providers,
        has_cuda
    );

    if !has_cuda {
        return GPUCapability {
            available: false,
            device_count: None,
            memory_total: None,
            cuda_version: None,
        };
    }

    let cuda_version = parse_cuda_version(&providers);

    // nvidia-smi queries are done in spawn_blocking to avoid blocking the
    // async runtime (nvidia-smi is typically fast, < 50ms)
    let (device_count, memory_total) = tokio::task::spawn_blocking(|| {
        (
            count_cuda_devices_via_nvidia_smi(),
            query_gpu_memory_via_nvidia_smi(),
        )
    })
    .await
    .unwrap_or((None, None));

    GPUCapability {
        available: true,
        device_count,
        memory_total,
        cuda_version,
    }
}
