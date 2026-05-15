// =========================================================================================================
// FIT VIEW — Step 3
// =========================================================================================================
// Lets the user choose how source frames are scaled/cropped to fill the sprite cell:
//   Stretch → independent axis scaling (fast; distorts non-square content).
//   Crop    → scale so the short axis fills the cell, center-crop the rest.
//   Focus   → click the preview image to set a custom crop anchor point.
//
// In Focus mode the view fetches a first-frame preview via `extract_preview` (cached in state).
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View }      from './View';
import { state, FitMode } from '../state';
import { router }         from '../router';
import { html }           from '../ui/html';
import { extractPreview } from '../ipc';
import { getMaxFrames }   from '../state';

// =========================================================================================================
// Constants
// =========================================================================================================

// Descriptions moved into mount to access state.resolution

/** Fallback preview-wrap width (px) when getBoundingClientRect returns 0 on first render. */
const PREVIEW_WRAP_FALLBACK_WIDTH = 528;

// =========================================================================================================
// View
// =========================================================================================================

export class FitView implements View {
  private listeners: Array<() => void> = [];

  mount(container: HTMLElement): void {
    const res = state.resolution;
    const FIT_DESCRIPTIONS: Record<FitMode, string> = {
      [FitMode.STRETCH]: `Scale width and height independently to ${res}×${res}. Fastest; distorts non-square content.`,
      [FitMode.CROP]:    `Scale so the shorter axis fills ${res} px, then crop the center ${res}×${res} region.`,
      [FitMode.FOCUS]:   `Click on the preview to set the crop anchor. The ${res}×${res} crop will be centered on that point.`,
    };

    const root = html`
      <div>
        <div class="view-header">
          <span class="section-heading">Fit Mode</span>
        </div>
        <div class="view-body" style="display:flex; flex-direction:column; gap:16px;">
          <div>
            <div class="field-label" style="margin-bottom:8px;">How to fill ${res}×${res} cells</div>
            <div class="toggle-group" id="fit-group">
              <button type="button" id="btn-stretch" aria-pressed="false">Stretch</button>
              <button type="button" id="btn-crop"    aria-pressed="false">Crop</button>
              <button type="button" id="btn-focus"   aria-pressed="false">Focus</button>
            </div>
          </div>

          <p class="text-secondary" id="fit-desc"></p>

          <div id="focus-panel" style="display:none; flex-direction:column; gap:8px;">
            <p class="text-secondary" style="font-size:12px;">
              Click anywhere on the preview to set the anchor point. The crop will center on it.
            </p>
            <div class="fit-preview-wrap" id="preview-wrap">
              <img id="preview-img" src="" alt="First frame preview" draggable="false"
                   style="display:none; max-width:100%; max-height:320px;" />
              <div id="preview-placeholder" style="
                width:100%; height:200px;
                background: var(--bg-surface);
                display:flex; align-items:center; justify-content:center;
                user-select:none;
              ">
                <span class="text-secondary" style="font-size:12px; pointer-events:none;" id="placeholder-text">
                  Loading preview...
                </span>
              </div>
              <div class="crosshair" id="crosshair" style="display:none;"></div>
            </div>
            <div id="anchor-coords" style="display:none; align-items:center; gap:8px;">
              <span class="text-secondary" style="font-size:12px;">Anchor:</span>
              <span class="text-mono" style="font-size:12px;" id="anchor-display">—</span>
            </div>
          </div>
        </div>
        <div class="view-footer">
          <button class="btn-ghost"   id="back-btn" type="button">Back</button>
          <button class="btn-primary" id="next-btn" type="button">Output Options</button>
        </div>
      </div>
    `;

    container.appendChild(root);

    const btnStretch     = root.querySelector<HTMLButtonElement>('#btn-stretch')!;
    const btnCrop        = root.querySelector<HTMLButtonElement>('#btn-crop')!;
    const btnFocus       = root.querySelector<HTMLButtonElement>('#btn-focus')!;
    const fitDesc        = root.querySelector<HTMLElement>('#fit-desc')!;
    const focusPanel     = root.querySelector<HTMLElement>('#focus-panel')!;
    const previewWrap    = root.querySelector<HTMLElement>('#preview-wrap')!;
    const previewImg     = root.querySelector<HTMLImageElement>('#preview-img')!;
    const placeholder    = root.querySelector<HTMLElement>('#preview-placeholder')!;
    const placeholderTxt = root.querySelector<HTMLElement>('#placeholder-text')!;
    const crosshair      = root.querySelector<HTMLElement>('#crosshair')!;
    const anchorDisplay  = root.querySelector<HTMLElement>('#anchor-display')!;
    const anchorCoords   = root.querySelector<HTMLElement>('#anchor-coords')!;
    const backBtn        = root.querySelector<HTMLButtonElement>('#back-btn')!;
    const nextBtn        = root.querySelector<HTMLButtonElement>('#next-btn')!;

    // =========================================================================
    // Preview loading
    // =========================================================================

    const showPreviewImage = (base64: string): void => {
      previewImg.src         = `data:image/png;base64,${base64}`;
      previewImg.style.display   = 'block';
      placeholder.style.display  = 'none';
    };

    const loadPreview = async (): Promise<void> => {
      if (state.previewBase64) {
        showPreviewImage(state.previewBase64);
        return;
      }
      if (!state.inputPath) return;

      try {
        const base64        = await extractPreview(state.inputPath);
        state.previewBase64 = base64;
        showPreviewImage(base64);
      } catch (err) {
        placeholderTxt.textContent = 'Failed to load preview.';
        console.error('Preview error:', err);
      }
    };

    // =========================================================================
    // Crosshair
    // =========================================================================

    const placeCrosshair = (dispX: number, dispY: number, srcX: number, srcY: number): void => {
      crosshair.style.left       = `${dispX}px`;
      crosshair.style.top        = `${dispY}px`;
      crosshair.style.display    = 'block';
      anchorDisplay.textContent  = `${srcX}, ${srcY}`;
      anchorCoords.style.display = 'flex';
    };

    // =========================================================================
    // Fit mode toggle
    // =========================================================================

    const setFit = (mode: FitMode): void => {
      state.fitMode = mode;

      btnStretch.setAttribute('aria-pressed', mode === FitMode.STRETCH ? 'true' : 'false');
      btnCrop.setAttribute('aria-pressed',    mode === FitMode.CROP    ? 'true' : 'false');
      btnFocus.setAttribute('aria-pressed',   mode === FitMode.FOCUS   ? 'true' : 'false');

      fitDesc.textContent      = FIT_DESCRIPTIONS[mode];
      focusPanel.style.display = mode === FitMode.FOCUS ? 'flex' : 'none';

      if (mode === FitMode.FOCUS) {
        loadPreview();

        // Restore crosshair if anchor was already set (e.g. navigating back).
        if (state.anchorX !== null && state.anchorY !== null) {
          const info  = state.mediaInfo!;
          const wrapW = previewWrap.getBoundingClientRect().width || PREVIEW_WRAP_FALLBACK_WIDTH;
          const dispX = (state.anchorX / info.width)  * wrapW;
          const dispY = (state.anchorY / info.height) * (wrapW * (info.height / info.width));
          placeCrosshair(dispX, dispY, state.anchorX, state.anchorY);
        }
      }
    };

    // Restore state on mount.
    setFit(state.fitMode);

    const onStretch = (): void => setFit(FitMode.STRETCH);
    const onCrop    = (): void => setFit(FitMode.CROP);
    const onFocus   = (): void => setFit(FitMode.FOCUS);

    btnStretch.addEventListener('click', onStretch);
    btnCrop.addEventListener('click',    onCrop);
    btnFocus.addEventListener('click',   onFocus);

    // =========================================================================
    // Click-to-anchor — maps display coords to source pixel space
    // =========================================================================

    const onAreaClick = (e: MouseEvent): void => {
      if (state.fitMode !== FitMode.FOCUS) return;

      const target = e.currentTarget as HTMLElement;
      const rect   = target.getBoundingClientRect();
      const dispX  = e.clientX - rect.left;
      const dispY  = e.clientY - rect.top;

      const info   = state.mediaInfo!;
      const scaleX = info.width  / rect.width;
      const scaleY = info.height / rect.height;
      const srcX   = Math.round(dispX * scaleX);
      const srcY   = Math.round(dispY * scaleY);

      state.anchorX = srcX;
      state.anchorY = srcY;
      placeCrosshair(dispX, dispY, srcX, srcY);
    };

    previewImg.addEventListener('click', onAreaClick);

    // =========================================================================
    // Navigation
    // =========================================================================

    const onBack = async (): Promise<void> => {
      if (state.mediaInfo!.total_frames > getMaxFrames()) {
        const { ReductionView } = await import('./ReductionView');
        router.navigate(new ReductionView(), 2);
      } else {
        const { AnalysisView } = await import('./AnalysisView');
        router.navigate(new AnalysisView(), 1);
      }
    };

    const onNext = async (): Promise<void> => {
      // Default focus anchor to center if the user never clicked.
      if (state.fitMode === FitMode.FOCUS && (state.anchorX === null || state.anchorY === null)) {
        const info    = state.mediaInfo!;
        state.anchorX = Math.floor(info.width  / 2);
        state.anchorY = Math.floor(info.height / 2);
      }
      const { OptionsView } = await import('./OptionsView');
      router.navigate(new OptionsView(), 4);
    };

    backBtn.addEventListener('click', onBack);
    nextBtn.addEventListener('click', onNext);

    // =========================================================================
    // Cleanup registration
    // =========================================================================

    this.listeners.push(
      () => btnStretch.removeEventListener('click', onStretch),
      () => btnCrop.removeEventListener('click',    onCrop),
      () => btnFocus.removeEventListener('click',   onFocus),
      () => previewImg.removeEventListener('click', onAreaClick),
      () => backBtn.removeEventListener('click',    onBack),
      () => nextBtn.removeEventListener('click',    onNext),
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
