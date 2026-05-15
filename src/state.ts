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

/** Sprite cell resolution */
export enum Resolution {
  RES_128 = 128,
  RES_256 = 256,
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

/** Maximum number of frames a VRChat sprite sheet may contain given its resolution. */
export function getMaxFrames(res?: Resolution): number {
  const r = res ?? state.resolution;
  return r === Resolution.RES_256 ? 16 : 64;
}

/** Default frame count when the source frame count is unknown or exceeds max frames. */
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
  /** Sprite cell resolution. Defaults to 128x128. */
  resolution:     Resolution;
  /** Number of frames to place in the sprite sheet (1–getMaxFrames()). */
  frameCount:     number;
  /** Playback FPS stored only in the output filename; not embedded in PNG. */
  fps:            number;
  /** Stem of the output filename, without extension. */
  outputName:     string;
  /** Temp directory path returned by `extract_frames`. Cleared after `cleanup_temp`. */
  tempDir:        string | null;
  /** Base64-encoded first-frame PNG cached from `extract_preview`. */
  previewBase64:  string | null;
  /** Whether to drop duplicate frames (typically for GIFs). */
  removeDuplicateFrames: boolean;
  /** FGSM / Spatial pseudo-gradient noise level (0-100) */
  noiseFgsm:      number;
  /** High frequency structured noise level (0-100) */
  noiseHighFreq:  number;
  /** Sparse noise (salt & pepper) level (0-100) */
  noiseSparse:    number;
  /** Medium frequency Luma waves (0-100) */
  noiseLuma:      number;
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
  resolution:    Resolution.RES_128,
  frameCount:    DEFAULT_FRAME_COUNT,
  fps:           DEFAULT_FPS,
  outputName:    '',
  tempDir:       null,
  previewBase64: null,
  removeDuplicateFrames: false,
  noiseFgsm:     0,
  noiseHighFreq: 0,
  noiseSparse:   0,
  noiseLuma:     0,
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
  state.resolution    = Resolution.RES_128;
  state.frameCount    = DEFAULT_FRAME_COUNT;
  state.fps           = DEFAULT_FPS;
  state.outputName    = '';
  state.tempDir       = null;
  state.previewBase64 = null;
  state.removeDuplicateFrames = false;
  state.noiseFgsm     = 0;
  state.noiseHighFreq = 0;
  state.noiseSparse   = 0;
  state.noiseLuma     = 0;
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
 * - Known ≤ max frames → use exact count.
 * - Unknown (≤ 0) → fall back to DEFAULT_FRAME_COUNT.
 * - Exceeds max frames → leave at DEFAULT_FRAME_COUNT until ReductionView.
 */
export function defaultFrameCount(totalFrames: number): number {
  if (totalFrames > 0 && totalFrames <= getMaxFrames()) return totalFrames;
  return DEFAULT_FRAME_COUNT;
}
