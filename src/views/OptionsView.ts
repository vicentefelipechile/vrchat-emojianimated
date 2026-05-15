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
import { state, getMaxFrames, buildOutputFilename } from '../state';
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

    // If reduction is active, up to getMaxFrames() frames are extractable.
    // Otherwise cap at the actual total (never more than getMaxFrames()).
    const maxFramesLimit = getMaxFrames();
    const maxFrames = state.reductionMode
      ? maxFramesLimit
      : Math.min(totalFrames > 0 ? totalFrames : maxFramesLimit, maxFramesLimit);

    // Default to max frames when arriving from a reduction step.
    if (state.reductionMode && state.frameCount < maxFramesLimit && totalFrames > maxFramesLimit) {
      state.frameCount = maxFramesLimit;
    }
    // Safety clamp
    if (state.frameCount > maxFramesLimit) {
      state.frameCount = maxFramesLimit;
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

          <hr class="divider" />

          <div class="field">
            <label class="field-label">Adversarial Noise (Watermarking)</label>
            <p class="text-secondary" style="font-size:12px; margin-bottom:12px;">
              Combine different noise types to evade security checks. 0 = off, 100 = strong.
            </p>

            <div style="margin-bottom:12px; display:flex; align-items:center; gap:8px;">
              <span class="text-secondary" style="font-size:12px;">Preset:</span>
              <select id="noise-preset" style="background:var(--bg-surface); color:var(--text-primary); border:1px solid var(--border); border-radius:2px; padding:4px 8px; font-size:12px; outline:none; cursor:pointer;">
                <option value="custom">Custom</option>
                <option value="default">Default</option>
                <option value="soft">Soft Watermark (works most on 2D)</option>
                <option value="strong">Strong watermark</option>
              </select>
            </div>
            
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <div class="field-row">
                  <span class="text-secondary" style="font-size:12px; width:70px;">FGSM</span>
                  <input
                    type="range"
                    id="noise-fgsm"
                    min="0"
                    max="100"
                    value="${state.noiseFgsm}"
                    step="1"
                    style="flex:1;"
                  />
                  <span class="field-value" id="val-fgsm" style="width:24px;text-align:right;">${state.noiseFgsm}</span>
                </div>
                <span style="font-size:11px; color:var(--text-secondary); padding-left:78px;">
                  Subtle spatial noise on edges. Useful against basic filters.
                </span>
              </div>
              
              <div style="display:flex; flex-direction:column; gap:4px;">
                <div class="field-row">
                  <span class="text-secondary" style="font-size:12px; width:70px;">High Freq</span>
                  <input
                    type="range"
                    id="noise-highfreq"
                    min="0"
                    max="100"
                    value="${state.noiseHighFreq}"
                    step="1"
                    style="flex:1;"
                  />
                  <span class="field-value" id="val-highfreq" style="width:24px;text-align:right;">${state.noiseHighFreq}</span>
                </div>
                <span style="font-size:11px; color:var(--text-secondary); padding-left:78px;">
                  Checkerboard pattern. Resists VRChat compression better.
                </span>
              </div>
              
              <div style="display:flex; flex-direction:column; gap:4px;">
                <div class="field-row">
                  <span class="text-secondary" style="font-size:12px; width:70px;">Sparse</span>
                  <input
                    type="range"
                    id="noise-sparse"
                    min="0"
                    max="100"
                    value="${state.noiseSparse}"
                    step="1"
                    style="flex:1;"
                  />
                  <span class="field-value" id="val-sparse" style="width:24px;text-align:right;">${state.noiseSparse}</span>
                </div>
                <span style="font-size:11px; color:var(--text-secondary); padding-left:78px;">
                  Drastically alters random pixels (like "dead pixels").
                </span>
              </div>
              
              <div style="display:flex; flex-direction:column; gap:4px;">
                <div class="field-row">
                  <span class="text-secondary" style="font-size:12px; width:70px;">Luma Wave</span>
                  <input
                    type="range"
                    id="noise-luma"
                    min="0"
                    max="100"
                    value="${state.noiseLuma}"
                    step="1"
                    style="flex:1;"
                  />
                  <span class="field-value" id="val-luma" style="width:24px;text-align:right;">${state.noiseLuma}</span>
                </div>
                <span style="font-size:11px; color:var(--text-secondary); padding-left:78px;">
                  Medium frequency brightness waves. Survives scaling.
                </span>
              </div>
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
    const noiseFgsm       = root.querySelector<HTMLInputElement>('#noise-fgsm')!;
    const valFgsm         = root.querySelector<HTMLElement>('#val-fgsm')!;
    const noiseHighFreq   = root.querySelector<HTMLInputElement>('#noise-highfreq')!;
    const valHighFreq     = root.querySelector<HTMLElement>('#val-highfreq')!;
    const noiseSparse     = root.querySelector<HTMLInputElement>('#noise-sparse')!;
    const valSparse       = root.querySelector<HTMLElement>('#val-sparse')!;
    const noiseLuma       = root.querySelector<HTMLInputElement>('#noise-luma')!;
    const valLuma         = root.querySelector<HTMLElement>('#val-luma')!;
    const noisePreset     = root.querySelector<HTMLSelectElement>('#noise-preset')!;
    const filenamePreview = root.querySelector<HTMLElement>('#filename-preview')!;
    const backBtn         = root.querySelector<HTMLButtonElement>('#back-btn')!;
    const nextBtn         = root.querySelector<HTMLButtonElement>('#next-btn')!;

    // =========================================================================
    // Live filename preview & Init
    // =========================================================================

    if (state.noiseFgsm === 0 && state.noiseHighFreq === 0 && state.noiseSparse === 0 && state.noiseLuma === 0) {
      noisePreset.value = 'default';
    } else if (state.noiseFgsm === 0 && state.noiseHighFreq === 50 && state.noiseSparse === 0 && state.noiseLuma === 25) {
      noisePreset.value = 'strong';
    } else if (state.noiseFgsm === 0 && state.noiseHighFreq === 40 && state.noiseSparse === 0 && state.noiseLuma === 10) {
      noisePreset.value = 'soft';
    } else {
      noisePreset.value = 'custom';
    }

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

    const setCustomPreset = () => {
      noisePreset.value = 'custom';
    };

    const onFgsm = (): void => {
      state.noiseFgsm = parseInt(noiseFgsm.value, 10);
      valFgsm.textContent = String(state.noiseFgsm);
      setCustomPreset();
    };

    const onHighFreq = (): void => {
      state.noiseHighFreq = parseInt(noiseHighFreq.value, 10);
      valHighFreq.textContent = String(state.noiseHighFreq);
      setCustomPreset();
    };

    const onSparse = (): void => {
      state.noiseSparse = parseInt(noiseSparse.value, 10);
      valSparse.textContent = String(state.noiseSparse);
      setCustomPreset();
    };

    const onLuma = (): void => {
      state.noiseLuma = parseInt(noiseLuma.value, 10);
      valLuma.textContent = String(state.noiseLuma);
      setCustomPreset();
    };

    const onPresetSelect = (): void => {
      const val = noisePreset.value;
      if (val === 'default') {
        state.noiseFgsm = 0;
        state.noiseHighFreq = 0;
        state.noiseSparse = 0;
        state.noiseLuma = 0;
      } else if (val === 'soft') {
        state.noiseFgsm = 0;
        state.noiseHighFreq = 40;
        state.noiseSparse = 0;
        state.noiseLuma = 10;
      } else if (val === 'strong') {
        state.noiseFgsm = 0;
        state.noiseHighFreq = 50;
        state.noiseSparse = 0;
        state.noiseLuma = 25;
      }
      
      if (val !== 'custom') {
        noiseFgsm.value = String(state.noiseFgsm);
        valFgsm.textContent = String(state.noiseFgsm);
        noiseHighFreq.value = String(state.noiseHighFreq);
        valHighFreq.textContent = String(state.noiseHighFreq);
        noiseSparse.value = String(state.noiseSparse);
        valSparse.textContent = String(state.noiseSparse);
        noiseLuma.value = String(state.noiseLuma);
        valLuma.textContent = String(state.noiseLuma);
      }
    };

    slider.addEventListener('input',   onSlider);
    fpsInput.addEventListener('input', onFps);
    nameInput.addEventListener('input', onName);
    noiseFgsm.addEventListener('input', onFgsm);
    noiseHighFreq.addEventListener('input', onHighFreq);
    noiseSparse.addEventListener('input', onSparse);
    noiseLuma.addEventListener('input', onLuma);
    noisePreset.addEventListener('change', onPresetSelect);

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
      () => noiseFgsm.removeEventListener('input', onFgsm),
      () => noiseHighFreq.removeEventListener('input', onHighFreq),
      () => noiseSparse.removeEventListener('input', onSparse),
      () => noiseLuma.removeEventListener('input', onLuma),
      () => noisePreset.removeEventListener('change', onPresetSelect),
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
