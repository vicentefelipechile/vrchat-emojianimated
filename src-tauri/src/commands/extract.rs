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
    pub remove_duplicates: Option<bool>,
    pub cell_size: u32,
}

#[derive(Debug, Serialize)]
pub struct ExtractResult {
    pub temp_dir: String,
    pub actual_count: u32,
}

/// Build the -vf filter string depending on fit_mode.
fn build_vf(opts: &ExtractOptions) -> String {
    let cs = opts.cell_size;
    let scale_and_crop = match opts.fit_mode.as_str() {
        "stretch" => format!("scale={cs}:{cs}"),
        "crop" => {
            // Scale so shorter axis fills cell_size, then center-crop
            format!("scale='if(gt(a,1),{cs},-1)':'if(gt(a,1),-1,{cs})',crop={cs}:{cs}")
        }
        "focus" => {
            // anchor_x/y are pre-clamped crop offsets (computed by frontend).
            // We must scale the source to at least cell_size×cell_size first (maintaining aspect
            // ratio so the anchor offset remains meaningful), then crop.
            let cx = opts.anchor_x.unwrap_or(0).max(0);
            let cy = opts.anchor_y.unwrap_or(0).max(0);
            let src_w = opts.frame_width.unwrap_or(256) as i64;
            let src_h = opts.frame_height.unwrap_or(256) as i64;
            let cs_i64 = cs as i64;
            // Scale keeping aspect ratio so both dims ≥ cell_size
            if src_w >= cs_i64 && src_h >= cs_i64 {
                // Source large enough — no upscale needed, just crop
                format!("crop={cs}:{cs}:{cx}:{cy}")
            } else {
                // Need to upscale. Scale so the smaller dim reaches cell_size.
                let scale_str = if src_w <= src_h {
                    format!("scale={cs}:-1")
                } else {
                    format!("scale=-1:{cs}")
                };
                format!("{scale_str},crop={cs}:{cs}:{cx}:{cy}")
            }
        }
        _ => format!("scale={cs}:{cs}"),
    };

    let fps_filter = if opts.remove_duplicates.unwrap_or(false) {
        "".to_string()
    } else {
        format!("fps={},", opts.target_fps)
    };

    let dup_filter = if opts.remove_duplicates.unwrap_or(false) {
        "mpdecimate,"
    } else {
        ""
    };

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
                "{dup}minterpolate=fps={fps:.5}:mi_mode=mci,trim=end_frame={n},setpts=PTS-STARTPTS,{scale}",
                dup   = dup_filter,
                fps   = extract_fps,
                n     = opts.frame_count,
                scale = scale_and_crop,
            )
        }
        _ => {
            // Trim (start or end) — ffmpeg handles seeking via -ss/-sseof flags
            format!("{dup}{fps_filter}{scale_and_crop}", dup = dup_filter, fps_filter = fps_filter)
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

    let shell = app.shell();
    let ffmpeg_path = crate::commands::download::get_binaries_dir(&app)
        .map_err(|e| e.to_string())?
        .join("ffmpeg.exe");
    let ffmpeg_path_str = ffmpeg_path.to_string_lossy().to_string();

    // =========================================================================
    // TWO-PASS EXECUTION (if remove_duplicates is true)
    // =========================================================================
    if options.remove_duplicates.unwrap_or(false) {
        // Pass 1: Extract ALL unique frames with mpdecimate, scale, and crop. NO limits.
        let scale_and_crop = match options.fit_mode.as_str() {
            "stretch" => format!("scale={cs}:{cs}", cs = options.cell_size),
            "crop" => format!("scale='if(gt(a,1),{cs},-1)':'if(gt(a,1),-1,{cs})',crop={cs}:{cs}", cs = options.cell_size),
            "focus" => {
                let ax = options.anchor_x.unwrap_or(0);
                let ay = options.anchor_y.unwrap_or(0);
                let fw = options.frame_width.unwrap_or(options.cell_size);
                let scale_up = if fw < options.cell_size {
                    format!("scale={cs}:{cs},", cs = options.cell_size)
                } else {
                    "".to_string()
                };
                format!("{scale_up}crop={cs}:{cs}:{ax}:{ay}", cs = options.cell_size, ax = ax, ay = ay)
            }
            _ => format!("scale={cs}:{cs}", cs = options.cell_size),
        };

        let vf_pass1 = format!("mpdecimate,{}", scale_and_crop);

        let args_p1: Vec<String> = vec![
            "-y".to_string(),
            "-i".to_string(),
            options.input_path.clone(),
            "-vf".to_string(),
            vf_pass1,
            "-vsync".to_string(),
            "0".to_string(),
            "-q:v".to_string(),
            "2".to_string(),
            out_pattern_str.clone(),
        ];

        let output_p1 = shell
            .command(&ffmpeg_path_str)
            .args(args_p1)
            .output()
            .await
            .map_err(|e| format!("FFmpeg failed to start: {e}"))?;

        if !output_p1.status.success() {
            let err_log = String::from_utf8_lossy(&output_p1.stderr);
            return Err(format!("FFmpeg pass 1 error: {}", err_log));
        }

        // Count extracted frames
        let mut actual_count = 0;
        while std::path::Path::new(&tmp_path).join(format!("frame_{:04}.png", actual_count + 1)).exists() {
            actual_count += 1;
        }

        // If after dropping duplicates we are BELOW or EQUAL to the threshold, we are DONE!
        if actual_count <= options.frame_count {
            return Ok(ExtractResult {
                temp_dir: tmp_str,
                actual_count,
            });
        }

        // Pass 2: The count is still ABOVE the threshold, so we MUST apply reduction.
        match options.reduction_mode.as_deref() {
            Some("trim_start") => {
                // Keep first N, delete the rest
                for i in (options.frame_count + 1)..=actual_count {
                    let p = tmp_path.join(format!("frame_{:04}.png", i));
                    let _ = std::fs::remove_file(p);
                }
                return Ok(ExtractResult { temp_dir: tmp_str, actual_count: options.frame_count });
            }
            Some("trim_end") => {
                // Keep last N, rename them to 1..N, delete the rest
                let start_idx = actual_count - options.frame_count + 1;
                for i in 1..=options.frame_count {
                    let old_p = tmp_path.join(format!("frame_{:04}.png", start_idx + i - 1));
                    let new_p = tmp_path.join(format!("frame_{:04}_new.png", i));
                    let _ = std::fs::rename(&old_p, &new_p);
                }
                // Delete everything else
                for entry in std::fs::read_dir(&tmp_path).unwrap().flatten() {
                    let p = entry.path();
                    if p.file_name().unwrap().to_string_lossy().contains("_new") {
                        let new_name = p.to_string_lossy().replace("_new", "");
                        let _ = std::fs::rename(&p, new_name);
                    } else {
                        let _ = std::fs::remove_file(p);
                    }
                }
                return Ok(ExtractResult { temp_dir: tmp_str, actual_count: options.frame_count });
            }
            Some("interpolate") => {
                // Run a second ffmpeg pass over the extracted frames
                let tmp_p2 = TempDir::new().map_err(|e| format!("Cannot create temp dir 2: {e}"))?;
                let tmp_p2_path = tmp_p2.keep();
                let out_p2_str = tmp_p2_path.join("frame_%04d.png").to_string_lossy().to_string();

                let extract_fps = if let Some(d) = options.duration_secs {
                    if d > 0.0 { options.frame_count as f64 / d } else { options.target_fps as f64 }
                } else { options.target_fps as f64 };

                let vf_p2 = format!("minterpolate=fps={fps:.5}:mi_mode=mci", fps = extract_fps);

                let args_p2 = vec![
                    "-y".to_string(),
                    "-framerate".to_string(),
                    options.target_fps.to_string(),
                    "-i".to_string(),
                    out_pattern_str,
                    "-vf".to_string(),
                    vf_p2,
                    "-frames:v".to_string(),
                    options.frame_count.to_string(),
                    "-q:v".to_string(),
                    "2".to_string(),
                    out_p2_str,
                ];

                let output_p2 = shell.command(&ffmpeg_path_str).args(args_p2).output().await.unwrap();
                if !output_p2.status.success() {
                    return Err(format!("FFmpeg pass 2 error: {}", String::from_utf8_lossy(&output_p2.stderr)));
                }

                let _ = std::fs::remove_dir_all(&tmp_path); // Cleanup pass 1 dir

                let mut final_count = 0;
                while std::path::Path::new(&tmp_p2_path).join(format!("frame_{:04}.png", final_count + 1)).exists() {
                    final_count += 1;
                }

                return Ok(ExtractResult {
                    temp_dir: tmp_p2_path.to_string_lossy().to_string(),
                    actual_count: final_count,
                });
            }
            _ => {
                // Default fallback, just like trim_start
                for i in (options.frame_count + 1)..=actual_count {
                    let p = tmp_path.join(format!("frame_{:04}.png", i));
                    let _ = std::fs::remove_file(p);
                }
                return Ok(ExtractResult { temp_dir: tmp_str, actual_count: options.frame_count });
            }
        }
    }

    // =========================================================================
    // STANDARD ONE-PASS EXECUTION (if remove_duplicates is false)
    // =========================================================================

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

    let output = shell
        .command(&ffmpeg_path_str)
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
