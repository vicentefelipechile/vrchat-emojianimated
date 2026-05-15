// src-tauri/src/commands/assemble.rs
// Assembles extracted frame PNGs into a 1024×1024 RGBA sprite sheet using the `image` crate.

use image::{GenericImage, ImageBuffer, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

const SHEET_SIZE: u32 = 1024;

#[derive(Debug, Deserialize)]
pub struct AssembleOptions {
    pub temp_dir: String,
    pub frame_count: u32,
    pub output_path: String,
    pub cell_size: u32,
    pub noise_fgsm: u8,
    pub noise_high_freq: u8,
    pub noise_sparse: u8,
    pub noise_luma: u8,
}

#[derive(Debug, Serialize)]
pub struct AssembleResult {
    pub output_path: String,
    pub file_size_bytes: u64,
    pub preview_base64: String, // PNG encoded as base64 for in-app canvas preview
}

#[tauri::command]
pub async fn assemble_sheet(options: AssembleOptions) -> Result<AssembleResult, String> {
    // Blank 1024×1024 transparent canvas
    let mut sheet: RgbaImage = ImageBuffer::from_pixel(
        SHEET_SIZE,
        SHEET_SIZE,
        Rgba([0u8, 0u8, 0u8, 0u8]),
    );

    let cell_size = options.cell_size;
    let grid_cols = SHEET_SIZE / cell_size;
    let grid_rows = SHEET_SIZE / cell_size;

    let frame_count = options.frame_count.min(grid_cols * grid_rows);

    for i in 0..frame_count {
        // ffmpeg names frames frame_0001.png, frame_0002.png … (1-indexed)
        let frame_path = std::path::Path::new(&options.temp_dir)
            .join(format!("frame_{:04}.png", i + 1));

        if !frame_path.exists() {
            // If ffmpeg produced fewer frames than expected, leave cell transparent
            break;
        }

        let frame_img = image::open(&frame_path)
            .map_err(|e| format!("Failed to open frame {}: {e}", i + 1))?
            .to_rgba8();

        // Validate / resize to exactly cell_size x cell_size if needed
        let frame_img = if frame_img.width() != cell_size || frame_img.height() != cell_size {
            image::imageops::resize(
                &frame_img,
                cell_size,
                cell_size,
                image::imageops::FilterType::Lanczos3,
            )
        } else {
            frame_img
        };

        // Row-major placement: col = i % grid_cols, row = i / grid_cols
        let col = i % grid_cols;
        let row = i / grid_cols;
        let x = col * cell_size;
        let y = row * cell_size;

        sheet
            .copy_from(&frame_img, x, y)
            .map_err(|e| format!("Failed to blit frame {} at ({x},{y}): {e}", i + 1))?;
    }

    // Apply adversarial noise if requested
    if options.noise_fgsm > 0 || options.noise_high_freq > 0 || options.noise_sparse > 0 || options.noise_luma > 0 {
        let original = sheet.clone();
        let width = sheet.width();
        let height = sheet.height();

        let fgsm_epsilon = ((options.noise_fgsm as f32 / 100.0) * 50.0) as i32;
        let high_freq_amp = ((options.noise_high_freq as f32 / 100.0) * 40.0) as i32;
        let sparse_prob = (options.noise_sparse as f32 / 100.0) * 0.10; // Up to 10% of pixels
        let luma_amp = ((options.noise_luma as f32 / 100.0) * 45.0) as i32;

        for y in 0..height {
            for x in 0..width {
                let pixel = sheet.get_pixel_mut(x, y);
                
                // Only add noise to non-transparent pixels
                if pixel.0[3] == 0 {
                    continue;
                }

                let mut new_rgb = [0i32; 3];
                for c in 0..3 {
                    new_rgb[c] = original.get_pixel(x, y).0[c] as i32;
                }

                // 1. FGSM Spatial Noise
                if fgsm_epsilon > 0 {
                    for c in 0..3 {
                        let val_curr = new_rgb[c];
                        let val_right = if x + 1 < width { original.get_pixel(x + 1, y).0[c] as i32 } else { val_curr };
                        let val_bottom = if y + 1 < height { original.get_pixel(x, y + 1).0[c] as i32 } else { val_curr };
                        let val_left = if x > 0 { original.get_pixel(x - 1, y).0[c] as i32 } else { val_curr };
                        let val_top = if y > 0 { original.get_pixel(x, y - 1).0[c] as i32 } else { val_curr };
                        
                        let grad_x = val_right - val_left;
                        let grad_y = val_bottom - val_top;
                        let mut grad = grad_x + grad_y;
                        
                        let noise_seed = x.wrapping_add(y.wrapping_mul(width)).wrapping_add(c as u32);
                        let pseudo_rand = ((noise_seed.wrapping_mul(1103515245).wrapping_add(12345) >> 16) & 0x7) as i32 - 3;
                        
                        if grad == 0 {
                            grad = pseudo_rand;
                        }
                        
                        let sign = if grad > 0 { 1 } else if grad < 0 { -1 } else { 0 };
                        let variance_factor = (grad.abs() as f32 / 255.0).max(0.15).min(1.0);
                        let perturbation = (sign * fgsm_epsilon as i32) as f32 * variance_factor;
                        
                        new_rgb[c] += perturbation as i32;
                    }
                }

                // 2. High Frequency Structured Noise
                if high_freq_amp > 0 {
                    let hf_pattern = if (x % 2 == 0) ^ (y % 2 == 0) { 1 } else { -1 };
                    let modulation = ((x as f32 * 0.5).sin() * (y as f32 * 0.5).cos()) as f32;
                    let perturbation = (hf_pattern as f32 * high_freq_amp as f32 * (0.5 + 0.5 * modulation)) as i32;
                    
                    for c in 0..3 {
                        new_rgb[c] += perturbation;
                    }
                }

                // 3. Sparse Noise (Salt & Pepper extreme shifts)
                if options.noise_sparse > 0 {
                    let noise_seed = x.wrapping_add(y.wrapping_mul(width));
                    let pseudo_rand = (noise_seed.wrapping_mul(1103515245).wrapping_add(12345) & 0xFFFF) as f32 / 65535.0;
                    
                    if pseudo_rand < sparse_prob {
                        let shift = if pseudo_rand < sparse_prob / 2.0 { 100 } else { -100 };
                        for c in 0..3 {
                            new_rgb[c] += shift;
                        }
                    }
                }

                // 4. Mid Frequency Luma Wave
                if luma_amp > 0 {
                    let wave1 = (x as f32 * 0.25).sin() * (y as f32 * 0.25).cos();
                    let wave2 = ((x as f32 + y as f32) * 0.15).sin();
                    let wave = wave1 + wave2; // Interference pattern
                    let perturbation = (wave * luma_amp as f32) as i32;
                    for c in 0..3 {
                        new_rgb[c] += perturbation;
                    }
                }

                // Clamp and assign back
                for c in 0..3 {
                    pixel.0[c] = new_rgb[c].clamp(0, 255) as u8;
                }
            }
        }
    }

    // Encode to PNG bytes in memory for base64 preview (before saving to disk)
    let mut png_bytes: Vec<u8> = Vec::new();
    {
        use image::ImageEncoder;
        let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
        encoder
            .write_image(
                sheet.as_raw(),
                SHEET_SIZE,
                SHEET_SIZE,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|e| format!("Failed to encode preview PNG: {e}"))?;
    }
    let preview_base64 = encode_base64(&png_bytes);

    // Save as PNG to disk
    sheet
        .save(&options.output_path)
        .map_err(|e| format!("Failed to save sprite sheet: {e}"))?;

    let file_size_bytes = std::fs::metadata(&options.output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(AssembleResult {
        output_path: options.output_path,
        file_size_bytes,
        preview_base64,
    })
}

/// Encode bytes to base64 using only std (no external crate needed).
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
