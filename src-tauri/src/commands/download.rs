use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tempfile::NamedTempFile;
use zip::ZipArchive;
use std::sync::atomic::{AtomicBool, Ordering};

static IS_DOWNLOADING: AtomicBool = AtomicBool::new(false);

const FFMPEG_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub percentage: u32,
    pub status: String,
}

pub fn get_binaries_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Could not resolve app_local_data_dir: {}", e))?
        .join("binaries");

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create binaries dir: {}", e))?;
    }
    Ok(dir)
}

#[tauri::command]
pub async fn check_dependencies(app: AppHandle) -> Result<bool, String> {
    let dir = get_binaries_dir(&app)?;
    let ffmpeg = dir.join("ffmpeg.exe");
    let ffprobe = dir.join("ffprobe.exe");
    Ok(ffmpeg.exists() && ffprobe.exists())
}

#[tauri::command]
pub async fn download_dependencies(app: AppHandle) -> Result<(), String> {
    let dir = get_binaries_dir(&app)?;
    let ffmpeg_path = dir.join("ffmpeg.exe");
    let ffprobe_path = dir.join("ffprobe.exe");

    // If they already exist, we are good.
    if ffmpeg_path.exists() && ffprobe_path.exists() {
        return Ok(());
    }

    if IS_DOWNLOADING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        // Already downloading, just return and let the other task finish
        return Ok(());
    }

    app.emit("download_progress", DownloadProgress {
        percentage: 0,
        status: "Starting download...".to_string(),
    }).unwrap();

    let res = async {
        let mut response = reqwest::get(FFMPEG_URL)
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        let total_size = response.content_length().unwrap_or(110_000_000) as f64;
        let mut downloaded: u64 = 0;

        let mut tmp_file = NamedTempFile::new().map_err(|e| format!("FS error: {}", e))?;
        let mut last_percent = 0;

        while let Some(chunk) = response.chunk().await.map_err(|e| format!("Download error: {}", e))? {
            tmp_file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
            downloaded += chunk.len() as u64;

            let percent = ((downloaded as f64 / total_size) * 100.0) as u32;
            if percent > last_percent {
                last_percent = percent;
                let _ = app.emit("download_progress", DownloadProgress {
                    percentage: percent,
                    status: format!("Downloading FFmpeg... {}%", percent),
                });
            }
        }

        let _ = app.emit("download_progress", DownloadProgress {
            percentage: 100,
            status: "Extracting binaries... Please wait.".to_string(),
        });

        let file = tmp_file.into_file();
        let mut archive = ZipArchive::new(file).map_err(|e| format!("ZIP error: {}", e))?;

        let mut extracted = 0;
        for i in 0..archive.len() {
            let mut inner_file = archive.by_index(i).unwrap();
            let name = inner_file.name().to_string();

            if name.ends_with("ffmpeg.exe") {
                let mut out = fs::File::create(&ffmpeg_path).map_err(|e| format!("Extract error: {}", e))?;
                std::io::copy(&mut inner_file, &mut out).map_err(|e| format!("Write error: {}", e))?;
                extracted += 1;
            } else if name.ends_with("ffprobe.exe") {
                let mut out = fs::File::create(&ffprobe_path).map_err(|e| format!("Extract error: {}", e))?;
                std::io::copy(&mut inner_file, &mut out).map_err(|e| format!("Write error: {}", e))?;
                extracted += 1;
            }

            if extracted >= 2 {
                break;
            }
        }

        if extracted < 2 {
            return Err("ZIP did not contain ffmpeg.exe and ffprobe.exe.".to_string());
        }

        let _ = app.emit("download_progress", DownloadProgress {
            percentage: 100,
            status: "Done! Starting application...".to_string(),
        });

        Ok(())
    }.await;

    IS_DOWNLOADING.store(false, Ordering::SeqCst);
    res
}
