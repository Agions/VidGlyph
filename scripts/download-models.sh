#!/usr/bin/env bash
# ==============================================================================
# VidGlyph Native ONNX OCR Models Downloader
#
# Downloads PP-OCRv4 detection and recognition ONNX models into `src-tauri/models/`.
# These models power the native Rust zero-copy streaming pipeline.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$PROJECT_ROOT/src-tauri/models"

mkdir -p "$MODELS_DIR"

DET_URL="https://github.com/RapidAI/RapidOCR/releases/download/v1.1.0/ch_PP-OCRv4_det_infer.onnx"
REC_URL="https://github.com/RapidAI/RapidOCR/releases/download/v1.1.0/ch_PP-OCRv4_rec_infer.onnx"

DET_FILE="$MODELS_DIR/det.onnx"
REC_FILE="$MODELS_DIR/rec.onnx"

echo "=========================================="
echo " VidGlyph Native OCR Model Downloader"
echo " Target directory: $MODELS_DIR"
echo "=========================================="

download_file() {
    local url="$1"
    local dest="$2"
    local name="$3"

    if [ -f "$dest" ] && [ -s "$dest" ]; then
        echo "✓ $name already exists: $(basename "$dest")"
    else
        echo "↓ Downloading $name..."
        if command -v curl >/dev/null 2>&1; then
            curl -L -C - --progress-bar "$url" -o "$dest"
        elif command -v wget >/dev/null 2>&1; then
            wget -c --show-progress "$url" -O "$dest"
        else
            echo "Error: Neither curl nor wget is available." >&2
            exit 1
        fi
        echo "✓ Downloaded $name."
    fi
}

download_file "$DET_URL" "$DET_FILE" "PP-OCRv4 Detection Model"
download_file "$REC_URL" "$REC_FILE" "PP-OCRv4 Recognition Model"

echo ""
echo "All native OCR models are ready in $MODELS_DIR"
