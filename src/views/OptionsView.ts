// =========================================================================================================
// OPTIONS VIEW — Step 4
// =========================================================================================================
// Lets the user configure the final output parameters before export:
//   Frame count → slider, 1–maxFrames (capped at MAX_FRAMES).
//   Playback FPS → numeric input, 1–120. Stored in filename only; not embedded in PNG.
//   Output name  → text input, becomes the stem of the output filename.
//
// Shows a live filename preview: <Name>_<N>frames_<FPS>fps.png
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View }                          from './View';
import { state, MAX_FRAMES, buildOutputFilename } from '../state';
import { router }                             from '../router';
import { html }                               from '../ui/html';

// =========================================================================================================
// Constants
// =========================================================================================================

/** Minimum allowed FPS value. */
const MIN_FPS = 1;

/** Maximum allowed FPS value. */
const MAX_FPS = 120;

// =========================================================================================================
// View
// =========================================================================================================

export class OptionsView implements View {
  private listeners: Array<() => void> = [];

  mount(container: HTMLElement): void {
    const totalFrames = state.mediaInfo?.total_frames ?? DEFAULT_FRAME_FALLBACK;

    // If reduction is active, up to MAX_FRAMES frames are extractable.
    // Otherwise cap at the actual total (never more than MAX_FRAMES).
    const maxFrames = state.reductionMode
      ? MAX_FRAMES
      : Math.min(totalFrames > 0 ? totalFrames : MAX_FRAMES, MAX_FRAMES);

    // Default to MAX_FRAMES when arriving from a reduction step.
    if (state.reductionMode && state.frameCount < MAX_FRAMES && totalFrames > MAX_FRAMES) {
      state.frameCount = MAX_FRAMES;
    }

    const root = html`
      <div>
        <div class="view-header">
          <span class="section-heading">Output Options</span>
        </div>
        <div class="view-body" style="display:flex; flex-direction:column; gap:16px;">

          <div class="field">
            <label class="field-label" for="frame-slider">Frame count</label>
            <div class="field-row">
              <input
                type="range"
                id="frame-slider"
                min="1"
                max="${maxFrames}"
                value="${state.frameCount}"
                step="1"
                style="flex:1;"
              />
              <span class="field-value" id="frame-val">${state.frameCount}</span>
            </div>
            <p class="text-secondary" style="font-size:12px;">
              How many frames to place in the sprite sheet (1–${maxFrames}). Unused cells are transparent.
            </p>
          </div>

          <hr class="divider" />

          <div class="field">
            <label class="field-label" for="fps-input">Playback FPS</label>
            <div class="field-row">
              <input
                type="number"
                id="fps-input"
                min="${MIN_FPS}"
                max="${MAX_FPS}"
                value="${state.fps}"
                style="width:80px;"
              />
              <span class="text-secondary" style="font-size:12px;">Stored in filename only — not embedded in the PNG.</span>
            </div>
          </div>

          <hr class="divider" />

          <div class="field">
            <label class="field-label" for="name-input">Output name</label>
            <input
              type="text"
              id="name-input"
              value="${state.outputName}"
              placeholder="e.g. EmojiAnimated"
            />
            <div class="flex items-center gap-8 mt-8">
              <span class="text-secondary" style="font-size:12px;">Preview:</span>
              <span class="text-mono" id="filename-preview" style="font-size:12px; color:var(--text-primary);"></span>
            </div>
          </div>

        </div>
        <div class="view-footer">
          <button class="btn-ghost"   id="back-btn" type="button">Back</button>
          <button class="btn-primary" id="next-btn" type="button">Generate Sprite Sheet</button>
        </div>
      </div>
    `;

    container.appendChild(root);

    const slider          = root.querySelector<HTMLInputElement>('#frame-slider')!;
    const frameVal        = root.querySelector<HTMLElement>('#frame-val')!;
    const fpsInput        = root.querySelector<HTMLInputElement>('#fps-input')!;
    const nameInput       = root.querySelector<HTMLInputElement>('#name-input')!;
    const filenamePreview = root.querySelector<HTMLElement>('#filename-preview')!;
    const backBtn         = root.querySelector<HTMLButtonElement>('#back-btn')!;
    const nextBtn         = root.querySelector<HTMLButtonElement>('#next-btn')!;

    // =========================================================================
    // Live filename preview
    // =========================================================================

    const updatePreview = (): void => {
      filenamePreview.textContent = buildOutputFilename();
    };

    updatePreview();

    // =========================================================================
    // Input handlers
    // =========================================================================

    const onSlider = (): void => {
      state.frameCount        = parseInt(slider.value, 10);
      frameVal.textContent    = String(state.frameCount);
      updatePreview();
    };

    const onFps = (): void => {
      const v = parseInt(fpsInput.value, 10);
      if (v >= MIN_FPS && v <= MAX_FPS) state.fps = v;
      updatePreview();
    };

    const onName = (): void => {
      state.outputName = nameInput.value;
      updatePreview();
    };

    slider.addEventListener('input',   onSlider);
    fpsInput.addEventListener('input', onFps);
    nameInput.addEventListener('input', onName);

    // =========================================================================
    // Navigation
    // =========================================================================

    const onBack = async (): Promise<void> => {
      const { FitView } = await import('./FitView');
      router.navigate(new FitView(), 3);
    };

    const onNext = async (): Promise<void> => {
      const { ExportView } = await import('./ExportView');
      router.navigate(new ExportView(), 5);
    };

    backBtn.addEventListener('click', onBack);
    nextBtn.addEventListener('click', onNext);

    // =========================================================================
    // Cleanup registration
    // =========================================================================

    this.listeners.push(
      () => slider.removeEventListener('input',    onSlider),
      () => fpsInput.removeEventListener('input',  onFps),
      () => nameInput.removeEventListener('input', onName),
      () => backBtn.removeEventListener('click',   onBack),
      () => nextBtn.removeEventListener('click',   onNext),
    );
  }

  // =========================================================================================================
  // Lifecycle
  // =========================================================================================================

  unmount(): void {
    this.listeners.forEach(fn => fn());
    this.listeners = [];
  }
}

// =========================================================================================================
// Module-private constants
// =========================================================================================================

/** Fallback total-frame count used when mediaInfo is unavailable (should not normally occur). */
const DEFAULT_FRAME_FALLBACK = 16;
