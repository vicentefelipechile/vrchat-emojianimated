// src-tauri/src/commands/analyze.rs
// Runs ffprobe as a sidecar to extract media metadata.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub total_frames: i64, // -1 = unknown
    pub duration_secs: f64,
    pub format: String, // "gif" | "video"
}

/// Minimal subset of what ffprobe returns per stream.
#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    nb_frames: Option<String>,
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Vec<FfprobeStream>,
}

/// Parse a rational like "30000/1001" into f64.
fn parse_rational(s: &str) -> f64 {
    let parts: Vec<&str> = s.splitn(2, '/').collect();
    if parts.len() == 2 {
        let num = parts[0].parse::<f64>().unwrap_or(0.0);
        let den = parts[1].parse::<f64>().unwrap_or(1.0);
        if den != 0.0 { num / den } else { 0.0 }
    } else {
        s.parse::<f64>().unwrap_or(0.0)
    }
}

#[tauri::command]
pub async fn analyze_media(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    let shell = app.shell();
    let ffprobe_path = crate::commands::download::get_binaries_dir(&app)
        .map_err(|e| e.to_string())?
        .join("ffprobe.exe");

    let output = shell
        .command(ffprobe_path.to_string_lossy().to_string())
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            &path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffprobe failed to run: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let probe: FfprobeOutput = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {e}\nRaw: {stdout}"))?;

    // Find first video stream
    let video = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .ok_or_else(|| "No video stream found".to_string())?;

    let width  = video.width.unwrap_or(0);
    let height = video.height.unwrap_or(0);
    let fps    = video.r_frame_rate.as_deref().map(parse_rational).unwrap_or(0.0);

    let duration_secs: f64 = video
        .duration
        .as_deref()
        .and_then(|d| d.parse().ok())
        .unwrap_or(0.0);

    let total_frames: i64 = if let Some(nb) = &video.nb_frames {
        nb.parse::<i64>().unwrap_or(-1)
    } else if duration_secs > 0.0 && fps > 0.0 {
        (duration_secs * fps).round() as i64
    } else {
        -1
    };

    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let format = if ext == "gif" { "gif" } else { "video" }.to_string();

    Ok(MediaInfo {
        width,
        height,
        fps,
        total_frames,
        duration_secs,
        format,
    })
}
