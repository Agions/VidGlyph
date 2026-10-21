//! Format-specific subtitle exporters.

use chrono;

use super::timestamp::{
    format_timestamp_ass, format_timestamp_sbv, format_timestamp_srt, format_timestamp_vtt,
};

pub use super::types::SubtitleItem;

// ─── Shared exporter for timed text formats (SRT, VTT, SBV) ───────────────────

/// Shared exporter for timed subtitle formats (SRT, VTT, SBV).
/// Takes a timestamp formatter and optional header string.
fn export_timed_entries<F>(subtitles: &[SubtitleItem], format_ts: F, header: Option<&str>) -> String
where
    F: Fn(f64) -> String,
{
    let cap =
        header.map_or(0, |h| h.len()) + subtitles.iter().map(|s| 50 + s.text.len()).sum::<usize>();
    let mut output = String::with_capacity(cap);
    if let Some(h) = header {
        output.push_str(h);
    }
    for sub in subtitles {
        let start = format_ts(sub.start_time);
        let end = format_ts(sub.end_time);
        use std::fmt::Write;
        let _ = write!(
            output,
            "{}\n{} --> {}\n{}\n\n",
            sub.index, start, end, sub.text
        );
    }
    output
}

pub fn export_as_srt(subtitles: &[SubtitleItem]) -> String {
    export_timed_entries(subtitles, format_timestamp_srt, None)
}

pub fn export_as_vtt(subtitles: &[SubtitleItem]) -> String {
    export_timed_entries(subtitles, format_timestamp_vtt, Some("WEBVTT\n\n"))
}

pub fn export_as_sbv(subtitles: &[SubtitleItem]) -> String {
    // SBV format: "start,end\ntext\n\n" — 复用 timed_entries 模式但使用不同的行格式
    let capacity = subtitles.iter().map(|s| 30 + s.text.len()).sum();
    let mut output = String::with_capacity(capacity);
    use std::fmt::Write;
    for sub in subtitles {
        let start = format_timestamp_sbv(sub.start_time);
        let end = format_timestamp_sbv(sub.end_time);
        let _ = write!(output, "{},{}\n{}\n\n", start, end, sub.text);
    }
    output
}

// ─── ASS / SSA family ────────────────────────────────────────────────────────

/// Escape special characters in ASS/SSA dialogue text.
///
/// `{` and `}` are wrapped (ASS override codes), `\` → `\\`,
/// `,` → `\,` (field separator), `\n` → `\N` (hard line break).
fn escape_ass_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .replace(',', "\\,")
        .replace('\n', "\\N")
}

/// Shared exporter for ASS/SSA family formats — differs only in header
/// template and dialogue prefix.
fn export_ass_family(
    subtitles: &[SubtitleItem],
    header_template: &str,
    dialogue_prefix: &str,
) -> String {
    let mut output = String::from(header_template);
    for sub in subtitles {
        let start = format_timestamp_ass(sub.start_time);
        let end = format_timestamp_ass(sub.end_time);
        let text = escape_ass_text(&sub.text);
        output.push_str(&format!(
            "Dialogue: {prefix},{start},{end},Default,,0,0,0,,{text}\n",
            prefix = dialogue_prefix,
            start = start,
            end = end,
            text = text
        ));
    }
    output
}

pub fn export_as_ass(subtitles: &[SubtitleItem]) -> String {
    let header = r#"[Script Info]
Title: VidGlyph Export
ScriptType: v4.00+
Collisions: Normal
PlayDepth: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"#;
    export_ass_family(subtitles, header, "0")
}

pub fn export_as_ssa(subtitles: &[SubtitleItem]) -> String {
    let header = r#"[Script Info]
Title: VidGlyph Export
ScriptType:v4.00
Collisions:Normal
PlayDepth:0

[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,Arial,20,16777215,65535,255,0,-1,0,1,2,2,2,10,10,10,0,1

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"#;
    export_ass_family(subtitles, header, "Marked=0")
}

// ─── Plain text / lyric sync ─────────────────────────────────────────────────

pub fn export_as_txt(subtitles: &[SubtitleItem]) -> String {
    subtitles
        .iter()
        .map(|sub| sub.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn export_as_lrc(subtitles: &[SubtitleItem]) -> String {
    let mut output = String::from(
        "[ti:VidGlyph Export]\n\
         [ar:VidGlyph]\n\
         [al:Subtitle Export]\n\
         [by:VidGlyph v1.0]\n\
         [offset:0]\n\
         [re:VidGlyph]\n\n",
    );
    for sub in subtitles {
        let mins = (sub.start_time / 60.0).floor() as u32;
        let secs = (sub.start_time % 60.0).floor() as u32;
        let centis = ((sub.start_time % 1.0) * 100.0).floor() as u32;
        output.push_str(&format!(
            "[{:02}:{:02}.{:02}]{}\n\n",
            mins, secs, centis, sub.text
        ));
    }
    output
}

// ─── Data formats ────────────────────────────────────────────────────────────

pub fn export_as_json(subtitles: &[SubtitleItem]) -> Result<String, String> {
    let output = serde_json::json!({
        "version": "1.0",
        "generatedAt": chrono::Local::now().to_rfc3339(),
        "tool": "VidGlyph",
        "subtitleCount": subtitles.len(),
        "subtitles": subtitles.iter().map(|sub| {
            serde_json::json!({
                "id": sub.id,
                "index": sub.index,
                "startTime": sub.start_time,
                "endTime": sub.end_time,
                "startFrame": sub.start_frame,
                "endFrame": sub.end_frame,
                "text": sub.text,
                "confidence": sub.confidence,
                "language": sub.language,
            })
        }).collect::<Vec<_>>()
    });
    serde_json::to_string_pretty(&output).map_err(|e| format!("JSON serialization failed: {}", e))
}

/// RFC 4180 compliant CSV export.
/// Fields containing commas, quotes, or newlines are wrapped in double quotes;
/// embedded double quotes are doubled.
pub fn export_as_csv(subtitles: &[SubtitleItem]) -> String {
    let mut output = String::from("Index,StartTime,EndTime,StartFrame,EndFrame,Text,Confidence\n");
    for sub in subtitles {
        let text_escaped = sub.text.replace('"', "\"\"");
        let needs_quoting = text_escaped.contains(',')
            || text_escaped.contains('"')
            || text_escaped.contains('\n')
            || text_escaped.contains('\r');
        let text_field = if needs_quoting {
            format!("\"{}\"", text_escaped)
        } else {
            text_escaped
        };

        output.push_str(&format!(
            "{},{:.3},{:.3},{},{},{},{:.3}\n",
            sub.index,
            sub.start_time,
            sub.end_time,
            sub.start_frame,
            sub.end_frame,
            text_field,
            sub.confidence
        ));
    }
    output
}
