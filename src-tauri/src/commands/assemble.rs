// src-tauri/src/commands/assemble.rs
// Assembles extracted frame PNGs into a 1024×1024 RGBA sprite sheet using the `image` crate.

use image::{GenericImage, ImageBuffer, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

const GRID_COLS: u32 = 8;
const GRID_ROWS: u32 = 8;
const CELL_SIZE: u32 = 128;
const SHEET_SIZE: u32 = 1024; // GRID_COLS * CELL_SIZE

#[derive(Debug, Deserialize)]
pub struct AssembleOptions {
    pub temp_dir: String,
    pub frame_count: u32,
    pub output_path: String,
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

    let frame_count = options.frame_count.min(GRID_COLS * GRID_ROWS);

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

        // Validate / resize to exactly 128×128 if needed
        let frame_img = if frame_img.width() != CELL_SIZE || frame_img.height() != CELL_SIZE {
            image::imageops::resize(
                &frame_img,
                CELL_SIZE,
                CELL_SIZE,
                image::imageops::FilterType::Lanczos3,
            )
        } else {
            frame_img
        };

        // Row-major placement: col = i % 8, row = i / 8
        let col = i % GRID_COLS;
        let row = i / GRID_COLS;
        let x = col * CELL_SIZE;
        let y = row * CELL_SIZE;

        sheet
            .copy_from(&frame_img, x, y)
            .map_err(|e| format!("Failed to blit frame {} at ({x},{y}): {e}", i + 1))?;
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
