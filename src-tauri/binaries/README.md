# Place the target-triple-suffixed ffmpeg and ffprobe binaries here before building.
#
# Required files (Windows x64):
#   ffmpeg-x86_64-pc-windows-msvc.exe
#   ffprobe-x86_64-pc-windows-msvc.exe
#
# macOS (Intel):
#   ffmpeg-x86_64-apple-darwin
#   ffprobe-x86_64-apple-darwin
#
# macOS (Apple Silicon):
#   ffmpeg-aarch64-apple-darwin
#   ffprobe-aarch64-apple-darwin
#
# Linux x64:
#   ffmpeg-x86_64-unknown-linux-gnu
#   ffprobe-x86_64-unknown-linux-gnu
#
# Download a static build from https://www.gyan.dev/ffmpeg/builds/ (Windows)
# or https://ffbinaries.com/downloads (cross-platform).
#
# Tauri will automatically copy the correct binary alongside the built executable.
