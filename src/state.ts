// =========================================================================================================
// APPLICATION STATE
// =========================================================================================================
// Central singleton that all views read from and write to.
// No reactivity — views pull what they need on mount().
// resetState() must be called before navigating back to DropView for a new file.
// =========================================================================================================

// =========================================================================================================
// Enums
// =========================================================================================================

/** Supported input media formats reported by ffprobe. */
export enum MediaFormat {
  GIF   = 'gif',
  VIDEO = 'video',
}

/** How to reduce a source with more than MAX_FRAMES frames down to the limit. */
export enum ReductionMode {
  TRIM_START  = 'trim_start',
  TRIM_END    = 'trim_end',
  INTERPOLATE = 'interpolate',
}

/** How to fill the 128×128 sprite cells from arbitrarily-sized source frames. */
export enum FitMode {
  STRETCH = 'stretch',
  CROP    = 'crop',
  FOCUS   = 'focus',
}

// =========================================================================================================
// Constants
// =========================================================================================================

/** Maximum number of frames a VRChat sprite sheet may contain. */
export const MAX_FRAMES = 64;

/** Default frame count when the source frame count is unknown or exceeds MAX_FRAMES. */
export const DEFAULT_FRAME_COUNT = 16;

/** Default playback FPS written into the output filename. */
export const DEFAULT_FPS = 24;

/** Default fit mode applied on first load. */
export const DEFAULT_FIT_MODE = FitMode.CROP;

// =========================================================================================================
// Types
// =========================================================================================================

/** Subset of ffprobe output returned by the `analyze_media` command. */
export interface MediaInfo {
  width:         number;
  height:        number;
  fps:           number;
  total_frames:  number;
  duration_secs: number;
  format:        MediaFormat;
}

/** Full application state shared across all views. */
export interface AppState {
  /** Full OS path to the input file selected by the user. */
  inputPath:      string | null;
  /** Result of `analyze_media`. Available from AnalysisView onward. */
  mediaInfo:      MediaInfo | null;
  /** Frame-reduction strategy. null means no reduction needed (total_frames ≤ MAX_FRAMES). */
  reductionMode:  ReductionMode | null;
  /** Fit mode for the 128×128 cell. Defaults to CROP. */
  fitMode:        FitMode;
  /** Source-space X pixel for focus-mode crop anchor. null until user clicks preview. */
  anchorX:        number | null;
  /** Source-space Y pixel for focus-mode crop anchor. null until user clicks preview. */
  anchorY:        number | null;
  /** Number of frames to place in the sprite sheet (1–MAX_FRAMES). */
  frameCount:     number;
  /** Playback FPS stored only in the output filename; not embedded in PNG. */
  fps:            number;
  /** Stem of the output filename, without extension. */
  outputName:     string;
  /** Temp directory path returned by `extract_frames`. Cleared after `cleanup_temp`. */
  tempDir:        string | null;
  /** Base64-encoded first-frame PNG cached from `extract_preview`. */
  previewBase64:  string | null;
}

// =========================================================================================================
// Singleton
// =========================================================================================================

export const state: AppState = {
  inputPath:     null,
  mediaInfo:     null,
  reductionMode: null,
  fitMode:       DEFAULT_FIT_MODE,
  anchorX:       null,
  anchorY:       null,
  frameCount:    DEFAULT_FRAME_COUNT,
  fps:           DEFAULT_FPS,
  outputName:    '',
  tempDir:       null,
  previewBase64: null,
};

// =========================================================================================================
// Helpers
// =========================================================================================================

/** Reset all fields to their initial defaults. Call before navigating back to DropView. */
export function resetState(): void {
  state.inputPath     = null;
  state.mediaInfo     = null;
  state.reductionMode = null;
  state.fitMode       = DEFAULT_FIT_MODE;
  state.anchorX       = null;
  state.anchorY       = null;
  state.frameCount    = DEFAULT_FRAME_COUNT;
  state.fps           = DEFAULT_FPS;
  state.outputName    = '';
  state.tempDir       = null;
  state.previewBase64 = null;
}

/**
 * Build the standard output filename from current state.
 * Format: `<Name>_<N>frames_<FPS>fps.png`
 */
export function buildOutputFilename(): string {
  const name = state.outputName.trim() || 'output';
  return `${name}_${state.frameCount}frames_${state.fps}fps.png`;
}

/**
 * Determine the sensible default frame count for a freshly analyzed file.
 * - Known ≤ MAX_FRAMES → use exact count.
 * - Unknown (≤ 0) → fall back to DEFAULT_FRAME_COUNT.
 * - Exceeds MAX_FRAMES → leave at DEFAULT_FRAME_COUNT until ReductionView.
 */
export function defaultFrameCount(totalFrames: number): number {
  if (totalFrames > 0 && totalFrames <= MAX_FRAMES) return totalFrames;
  return DEFAULT_FRAME_COUNT;
}
