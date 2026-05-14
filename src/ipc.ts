// =========================================================================================================
// IPC — Tauri command wrappers
// =========================================================================================================
// All invoke() calls live here. Import from this module — never call invoke() directly from views.
// Tauri auto-converts camelCase JS parameter names to snake_case on the Rust side.
//
// Argument wrapping rules (Tauri v2):
//   Single primitive  → invoke('cmd', { paramName })
//   Struct payload    → invoke('cmd', { options })   where Rust fn takes `options: MyStruct`
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { invoke }          from '@tauri-apps/api/core';
import type { MediaInfo }  from './state';
import { FitMode, ReductionMode } from './state';

// =========================================================================================================
// Re-exports — types imported by views
// =========================================================================================================

export type { MediaInfo };

// =========================================================================================================
// analyze_media
// =========================================================================================================

/** Run ffprobe on `path` and return stream metadata. */
export function analyzeMedia(path: string): Promise<MediaInfo> {
  return invoke<MediaInfo>('analyze_media', { path });
}

// =========================================================================================================
// extract_preview
// =========================================================================================================

/** Extract the first frame of `inputPath` as a base64-encoded PNG string. Cached in state. */
export function extractPreview(inputPath: string): Promise<string> {
  return invoke<string>('extract_preview', { inputPath });
}

// =========================================================================================================
// extract_frames
// =========================================================================================================

/** Options forwarded to the `extract_frames` Rust command. */
export interface ExtractOptions {
  /** Full OS path to the input file. */
  input_path:      string;
  /** Number of frames to extract (1–64). */
  frame_count:     number;
  /** Target playback FPS used for `-vf fps=` filter. */
  target_fps:      number;
  /** Scaling/crop strategy applied per cell. */
  fit_mode:        FitMode;
  /** Pre-clamped crop X offset in source pixels (focus mode only). */
  anchor_x?:       number;
  /** Pre-clamped crop Y offset in source pixels (focus mode only). */
  anchor_y?:       number;
  /** Source frame width — required for the focus upscale step in Rust. */
  frame_width?:    number;
  /** Source frame height — required for the focus upscale step in Rust. */
  frame_height?:   number;
  /** Frame-reduction strategy (omit when total_frames ≤ MAX_FRAMES). */
  reduction_mode?: ReductionMode;
  /** Source duration in seconds — required for interpolate FPS math. */
  duration_secs?:  number;
}

/** Result returned by the `extract_frames` Rust command. */
export interface ExtractResult {
  /** Path to the temporary directory containing `frame_0001.png … frame_NNNN.png`. */
  temp_dir:     string;
  /** Actual number of PNG files produced (may differ from frame_count). */
  actual_count: number;
}

/** Extract individual frames from the input file into a temporary directory. */
export function extractFrames(options: ExtractOptions): Promise<ExtractResult> {
  return invoke<ExtractResult>('extract_frames', { options });
}

// =========================================================================================================
// assemble_sheet
// =========================================================================================================

/** Options forwarded to the `assemble_sheet` Rust command. */
export interface AssembleOptions {
  /** Path to the temp directory produced by `extract_frames`. */
  temp_dir:     string;
  /** Number of frames to stitch (use `actual_count` from ExtractResult). */
  frame_count:  number;
  /** Full OS path for the output PNG file. */
  output_path:  string;
}

/** Result returned by the `assemble_sheet` Rust command. */
export interface AssembleResult {
  /** Final output path (echoed back for display). */
  output_path:      string;
  /** Size of the written PNG in bytes. */
  file_size_bytes:  number;
  /** Base64-encoded 1024×1024 PNG of the full sprite sheet (for canvas animation). */
  preview_base64:   string;
}

/** Stitch extracted frames into a 1024×1024 RGBA sprite sheet PNG. */
export function assembleSheet(options: AssembleOptions): Promise<AssembleResult> {
  return invoke<AssembleResult>('assemble_sheet', { options });
}

// =========================================================================================================
// cleanup_temp
// =========================================================================================================

/** Delete the temporary frame directory after successful assembly (or on error). */
export function cleanupTemp(tempDir: string): Promise<void> {
  return invoke<void>('cleanup_temp', { tempDir });
}

// =========================================================================================================
// Dialogs
// =========================================================================================================

/** Open a native save-file dialog pre-filled with `defaultPath`. Returns null if cancelled. */
export function saveFileDialog(defaultPath: string): Promise<string | null> {
  return invoke<string | null>('save_file_dialog', { defaultPath });
}

/** Open a native file-picker dialog filtered to supported media types. Returns null if cancelled. */
export function openFileDialog(): Promise<string | null> {
  return invoke<string | null>('open_file_dialog', {});
}

// =========================================================================================================
// Dependencies
// =========================================================================================================

export function checkDependencies(): Promise<boolean> {
  return invoke<boolean>('check_dependencies', {});
}

let downloadPromise: Promise<void> | null = null;
export function downloadDependencies(): Promise<void> {
  if (!downloadPromise) {
    downloadPromise = invoke<void>('download_dependencies', {}).catch(err => {
      downloadPromise = null;
      throw err;
    });
  }
  return downloadPromise;
}
