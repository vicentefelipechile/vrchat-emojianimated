// src-tauri/src/commands/extract.rs
// Runs ffmpeg as a sidecar to extract frames into a temp directory.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tempfile::TempDir;

/// Options passed from the frontend.
#[derive(Debug, Deserialize)]
pub struct ExtractOptions {
    pub input_path: String,
    pub frame_count: u32,
    pub target_fps: u32,
    pub fit_mode: String, // "stretch" | "crop" | "focus"
    /// For focus mode: pre-clamped crop X offset in source pixel space
    pub anchor_x: Option<i32>,
    /// For focus mode: pre-clamped crop Y offset in source pixel space
    pub anchor_y: Option<i32>,
    /// Source frame width (used for focus scale step)
    pub frame_width: Option<u32>,
    /// Source frame height (used for focus scale step)
    pub frame_height: Option<u32>,
    pub reduction_mode: Option<String>, // "trim_start" | "trim_end" | "interpolate"
    pub duration_secs: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ExtractResult {
    pub temp_dir: String,
    pub actual_count: u32,
}

/// Build the -vf filter string depending on fit_mode.
fn build_vf(opts: &ExtractOptions) -> String {
    let scale_and_crop = match opts.fit_mode.as_str() {
        "stretch" => "scale=128:128".to_string(),
        "crop" => {
            // Scale so shorter axis fills 128, then center-crop
            "scale='if(gt(a,1),128,-1)':'if(gt(a,1),-1,128)',crop=128:128".to_string()
        }
        "focus" => {
            // anchor_x/y are pre-clamped crop offsets (computed by frontend).
            // We must scale the source to at least 128×128 first (maintaining aspect
            // ratio so the anchor offset remains meaningful), then crop.
            let cx = opts.anchor_x.unwrap_or(0).max(0);
            let cy = opts.anchor_y.unwrap_or(0).max(0);
            let src_w = opts.frame_width.unwrap_or(256) as i64;
            let src_h = opts.frame_height.unwrap_or(256) as i64;
            // Scale keeping aspect ratio so both dims ≥ 128
            if src_w >= 128 && src_h >= 128 {
                // Source large enough — no upscale needed, just crop
                format!("crop=128:128:{cx}:{cy}")
            } else {
                // Need to upscale. Scale so the smaller dim reaches 128.
                let scale_str = if src_w <= src_h {
                    "scale=128:-1"
                } else {
                    "scale=-1:128"
                };
                format!("{scale_str},crop=128:128:{cx}:{cy}")
            }
        }
        _ => "scale=128:128".to_string(),
    };

    let fps_filter = format!("fps={}", opts.target_fps);

    match opts.reduction_mode.as_deref() {
        Some("interpolate") => {
            // Calculate the required fps to extract exactly N frames across the whole duration
            let extract_fps = if let Some(d) = opts.duration_secs {
                if d > 0.0 {
                    opts.frame_count as f64 / d
                } else {
                    opts.target_fps as f64
                }
            } else {
                opts.target_fps as f64
            };

            // minterpolate to blend the entire video down to extract_fps
            format!(
                "minterpolate=fps={fps:.5}:mi_mode=mci,trim=end_frame={n},setpts=PTS-STARTPTS,{scale}",
                fps   = extract_fps,
                n     = opts.frame_count,
                scale = scale_and_crop,
            )
        }
        _ => {
            // Trim (start or end) — ffmpeg handles seeking via -ss/-sseof flags
            format!("{fps_filter},{scale_and_crop}")
        }
    }
}

#[tauri::command]
pub async fn extract_frames(
    app: AppHandle,
    options: ExtractOptions,
) -> Result<ExtractResult, String> {
    // Create a persistent temp directory (caller is responsible for cleanup via cleanup_temp)
    let tmp = TempDir::new().map_err(|e| format!("Cannot create temp dir: {e}"))?;
    let tmp_path = tmp.keep(); // persist dir — caller cleans up via cleanup_temp
    let tmp_str  = tmp_path.to_string_lossy().to_string();

    let out_pattern = tmp_path.join("frame_%04d.png");
    let out_pattern_str = out_pattern.to_string_lossy().to_string();

    let vf = build_vf(&options);

    let mut args: Vec<String> = Vec::new();

    // Seeking for trim_end: seek from end-of-file
    if options.reduction_mode.as_deref() == Some("trim_end") {
        let duration_needed = options.frame_count as f64 / options.target_fps as f64;
        args.extend_from_slice(&["-sseof".to_string(), format!("-{duration_needed:.3}")]);
    }

    args.extend_from_slice(&["-i".to_string(), options.input_path.clone()]);
    args.extend_from_slice(&["-vf".to_string(), vf]);
    args.extend_from_slice(&["-frames:v".to_string(), options.frame_count.to_string()]);
    args.extend_from_slice(&["-q:v".to_string(), "1".to_string()]);
    args.push(out_pattern_str);

    let shell = app.shell();
    let ffmpeg_path = crate::commands::download::get_binaries_dir(&app)
        .map_err(|e| e.to_string())?
        .join("ffmpeg.exe");

    let output = shell
        .command(ffmpeg_path.to_string_lossy().to_string())
        .args(args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .output()
        .await
        .map_err(|e| format!("ffmpeg failed to run: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {stderr}"));
    }

    // Count actual PNG files produced
    let actual_count = std::fs::read_dir(&tmp_path)
        .map_err(|e| format!("Cannot read temp dir: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("png"))
                .unwrap_or(false)
        })
        .count() as u32;

    Ok(ExtractResult {
        temp_dir: tmp_str,
        actual_count,
    })
}

/// Delete the temp directory — called after assembly or on cancel.
#[tauri::command]
pub async fn cleanup_temp(temp_dir: String) -> Result<(), String> {
    if std::path::Path::new(&temp_dir).exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("cleanup_temp failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn extract_preview(app: AppHandle, input_path: String) -> Result<String, String> {
    let tmp = TempDir::new().map_err(|e| format!("Cannot create temp dir: {e}"))?;
    let out_path = tmp.path().join("preview.png");
    
    let shell = app.shell();
    let ffmpeg_path = crate::commands::download::get_binaries_dir(&app)
        .map_err(|e| e.to_string())?
        .join("ffmpeg.exe");

    let output = shell
        .command(ffmpeg_path.to_string_lossy().to_string())
        .args([
            "-y",
            "-i", &input_path,
            "-frames:v", "1",
            "-q:v", "2",
            &out_path.to_string_lossy().to_string()
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg failed to run: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg preview error: {stderr}"));
    }

    let bytes = std::fs::read(&out_path).map_err(|e| format!("Cannot read preview file: {e}"))?;
    Ok(encode_base64(&bytes))
}

/// Encode bytes to base64 using only std
fn encode_base64(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 0x3F) as usize]);
        out.push(CHARS[((n >> 12) & 0x3F) as usize]);
        out.push(if chunk.len() > 1 { CHARS[((n >> 6) & 0x3F) as usize] } else { b'=' });
        out.push(if chunk.len() > 2 { CHARS[(n & 0x3F) as usize] } else { b'=' });
    }
    String::from_utf8(out).unwrap()
}
