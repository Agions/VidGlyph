//! Standalone tests for SubLens's new Rust-native modules.
//!
//! Compile and run: `rustc tests/standalone_tests.rs -o /tmp/test_bin && /tmp/test_bin`
//!
//! These tests verify the pure logic functions from scene.rs and auto_roi.rs
//! without linking Tauri (saves 3+ GB of compile-time dependencies).

mod shared_core {
    include!("../src/commands/utils/shared_core.rs");
}

// ─── Scene detection utilities (extracted from scene.rs) ─────────────

fn map_threshold(config_threshold: f32) -> f32 {
    (config_threshold / 10.0).clamp(0.01, 1.0)
}

fn deduplicate_timestamps(timestamps: &[f64], min_gap: f64) -> Vec<f64> {
    let mut result: Vec<f64> = Vec::with_capacity(timestamps.len());
    for &ts in timestamps {
        // Skip timestamps below minimum scene length
        if ts < min_gap {
            continue;
        }
        if let Some(&last) = result.last() {
            // Use <= so exact min_gap is also deduplicated
            if ts - last <= min_gap {
                continue;
            }
        }
        result.push(ts);
    }
    result
}

// ─── Auto ROI utilities (extracted from auto_roi.rs) ───────────────

// ─── Tests ──────────────────────────────────────────────────────────

fn test_map_threshold_normal_range() {
    let result = map_threshold(0.3);
    assert!(
        (result - 0.03).abs() < 0.001,
        "0.3/10 = 0.03, got {}",
        result
    );
}

fn test_map_threshold_zero() {
    let result = map_threshold(0.0);
    assert!(
        (result - 0.01).abs() < 0.001,
        "minimum clamp 0.01, got {}",
        result
    );
}

fn test_map_threshold_high() {
    let result = map_threshold(100.0);
    assert!(
        (result - 1.0).abs() < 0.001,
        "maximum clamp 1.0, got {}",
        result
    );
}

fn test_parse_pts_times_basic() {
    let output = "\
[Parsed_showinfo_1 @ 0x...] pts_time:1.234
[Parsed_showinfo_1 @ 0x...] pts_time:5.678
[Parsed_showinfo_1 @ 0x...] pts_time:10.0
";
    let result = shared_core::parse_pts_times(output);
    assert_eq!(result.len(), 3);
    assert!((result[0] - 1.234).abs() < 0.001);
    assert!((result[1] - 5.678).abs() < 0.001);
    assert!((result[2] - 10.0).abs() < 0.001);
}

fn test_parse_pts_times_skips_zero() {
    let output = "[Parsed_showinfo_1 @ 0x...] pts_time:0.0";
    let result = shared_core::parse_pts_times(output);
    assert!(result.is_empty(), "Zero timestamps should be skipped");
}

fn test_parse_pts_times_no_matches() {
    let output = "just some regular ffmpeg output without pts_time";
    let result = shared_core::parse_pts_times(output);
    assert!(result.is_empty());
}

fn test_parse_pts_times_edge_cases() {
    let output = "\
pts_time:1.0
pts_time:abc
pts_time: 
pts_time:-5.0
pts_time:0.5
";
    let result = shared_core::parse_pts_times(output);
    assert_eq!(result.len(), 2, "Only 1.0 and 0.5 should parse");
    assert!((result[0] - 1.0).abs() < 0.001);
    assert!((result[1] - 0.5).abs() < 0.001);
}

fn test_deduplicate_empty() {
    assert!(deduplicate_timestamps(&[], 1.0).is_empty());
}

fn test_deduplicate_single() {
    let result = deduplicate_timestamps(&[5.0], 1.0);
    assert_eq!(result, vec![5.0]);
}

fn test_deduplicate_far_apart() {
    let result = deduplicate_timestamps(&[1.0, 5.0, 10.0], 2.0);
    assert_eq!(result.len(), 2, "1.0 is below min_gap, keep 5.0 and 10.0");
}

fn test_deduplicate_close_together() {
    let result = deduplicate_timestamps(&[1.0, 1.5, 2.0, 5.0], 1.0);
    assert_eq!(result.len(), 2, "Should keep 1.0 and 5.0");
    assert!((result[0] - 1.0).abs() < 0.001);
    assert!((result[1] - 5.0).abs() < 0.001);
}

fn test_deduplicate_below_min_gap() {
    let result = deduplicate_timestamps(&[0.5, 1.0, 2.0], 1.0);
    assert_eq!(
        result,
        vec![1.0],
        "0.5 is below min_gap, keep 1.0; 2.0 is within min_gap of 1.0"
    );
}

fn test_sobel_edges_uniform_image() {
    let width = 10;
    let height = 10;
    let pixels = vec![128u8; width * height];
    let edges = shared_core::sobel_edges_raw(&pixels, width, height);
    let edge_count: u32 = edges
        .iter()
        .map(|row| row.iter().filter(|&&p| p > 0).count() as u32)
        .sum();
    assert_eq!(edge_count, 0, "Uniform image should have no edges");
}

fn test_sobel_edges_edge_image() {
    let width = 10;
    let height = 10;
    let mut pixels = vec![0u8; width * height];
    for x in 0..width {
        pixels[5 * width + x] = 255;
    }
    let edges = shared_core::sobel_edges_raw(&pixels, width, height);
    let edge_count: u32 = edges
        .iter()
        .map(|row| row.iter().filter(|&&p| p > 0).count() as u32)
        .sum();
    assert!(edge_count > 0, "Edge image should have detected edges");
}

fn test_horizontal_projection_empty() {
    let result = shared_core::horizontal_projection(&[]);
    assert!(result.is_empty());
}

fn test_horizontal_projection_uniform() {
    let edges = vec![vec![0u8; 10], vec![0u8; 10], vec![0u8; 10]];
    let result = shared_core::horizontal_projection(&edges);
    assert_eq!(result.len(), 3);
    for &v in &result {
        assert!((v - 0.0).abs() < 0.001, "Row should be 0.0, got {}", v);
    }
}

fn test_horizontal_projection_with_edges() {
    let mut edges = vec![vec![0u8; 10]; 3];
    for x in 0..10 {
        edges[1][x] = 255;
    }
    let result = shared_core::horizontal_projection(&edges);
    assert!(
        (result[1] - 1.0).abs() < 0.001,
        "Full row should be 1.0, got {}",
        result[1]
    );
}

fn test_horizontal_projection_half_edges() {
    let mut edges = vec![vec![0u8; 10]; 2];
    for x in 0..5 {
        edges[0][x] = 255;
    }
    let result = shared_core::horizontal_projection(&edges);
    assert!(
        (result[0] - 0.5).abs() < 0.001,
        "Half row should be 0.5, got {}",
        result[0]
    );
}

// ─── Main ──────────────────────────────────────────────────────────

fn main() {
    let tests: [(&str, fn()); 18] = [
        (
            "map_threshold normal range",
            test_map_threshold_normal_range,
        ),
        ("map_threshold zero", test_map_threshold_zero),
        ("map_threshold high", test_map_threshold_high),
        ("parse_pts_times basic", test_parse_pts_times_basic),
        (
            "parse_pts_times skips zero",
            test_parse_pts_times_skips_zero,
        ),
        (
            "parse_pts_times no matches",
            test_parse_pts_times_no_matches,
        ),
        (
            "parse_pts_times edge cases",
            test_parse_pts_times_edge_cases,
        ),
        ("deduplicate empty", test_deduplicate_empty),
        ("deduplicate single", test_deduplicate_single),
        ("deduplicate far apart", test_deduplicate_far_apart),
        (
            "deduplicate close together",
            test_deduplicate_close_together,
        ),
        ("deduplicate below min_gap", test_deduplicate_below_min_gap),
        ("sobel_edges uniform image", test_sobel_edges_uniform_image),
        ("sobel_edges edge image", test_sobel_edges_edge_image),
        (
            "horizontal_projection empty",
            test_horizontal_projection_empty,
        ),
        (
            "horizontal_projection uniform",
            test_horizontal_projection_uniform,
        ),
        (
            "horizontal_projection with edges",
            test_horizontal_projection_with_edges,
        ),
        (
            "horizontal_projection half edges",
            test_horizontal_projection_half_edges,
        ),
    ];

    let mut passed = 0u32;
    let mut failed = 0u32;
    for (name, test_fn) in &tests {
        print!("  {:<45} ... ", name);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(test_fn));
        match result {
            Ok(_) => {
                println!("✅ PASS");
                passed += 1;
            }
            Err(e) => {
                let msg = if let Some(s) = e.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = e.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown".to_string()
                };
                println!("❌ FAIL: {}", msg);
                failed += 1;
            }
        }
    }

    println!("\n─────────────────────────────────────────");
    println!(
        "  Results: {passed} passed, {failed} failed, {} total",
        passed + failed
    );
    if failed > 0 {
        std::process::exit(1);
    }
}
