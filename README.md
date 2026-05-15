# VRChat Emoji Animator

**vrchat-emojianimate** is a lightweight, portable desktop tool that converts GIF and video files into **1024×1024 VRChat-compatible sprite sheets** (PNG format, up to 64 frames for 128×128 cells or 16 frames for 256×256 cells).

This tool is specifically designed for VRChat avatar and world creators who need a fast, zero-configuration way to turn media into sprite animations.

## Features

- **No Installation Required:** Distributed as a single, lightweight portable `.exe`.
- **Dynamic Dependencies:** To keep the application size under 10MB, the required FFmpeg binaries are automatically downloaded in the background on the first launch.
- **Broad Format Support:** Accepts `.gif`, `.mp4`, `.webm`, `.mov`, `.avi`, and `.mkv`.
- **Dynamic Resolution:** Choose between 128×128 cells (max 64 frames) or higher quality 256×256 cells (max 16 frames) depending on your needs.
- **Smart Cropping:** Multiple fit modes including Stretch, Crop, and a custom Focus Mode (crosshair selector) to ensure your animation fits the cell perfectly.
- **Frame Reduction:** For media exceeding the frame limit, the app can intelligently trim or use motion interpolation (`minterpolate`) to compress the video into exactly the right number of fluid frames.
- **VRChat Ready:** Outputs a raw, metadata-free PNG sheet formatted as `<Name>_<N>frames_<FPS>fps.png`.

## Tech Stack

This project is built with a focus on simplicity and performance:
- **Desktop Shell:** [Tauri v2](https://v2.tauri.app/) (Rust)
- **Frontend:** Vanilla TypeScript bundled with Vite 6. No heavy frameworks (No React, Vue, or Tailwind).
- **Video Processing:** FFmpeg & FFprobe (Downloaded dynamically on first use).
- **Image Assembly:** Rust `image` crate (in-memory fast assembly).

## Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- Visual Studio C++ Build Tools (for Windows Rust compilation)

### Running Locally

Clone the repository and install the frontend dependencies:

```bash
npm install
```

Start the Vite development server and the Tauri window simultaneously:

```bash
npm run tauri dev
```

### Production Build

To build the standalone portable executable:

```bash
npm run tauri build -- --no-bundle
```

The resulting executable will be located at `src-tauri/target/release/vrchat-emojianimate.exe`.

## License

MIT
