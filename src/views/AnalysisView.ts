// =========================================================================================================
// ANALYSIS VIEW — Step 1
// =========================================================================================================
// Displays the ffprobe results for the chosen file.
// Routes to ReductionView if total_frames > max frames, otherwise directly to FitView.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View } from './View';
import { state, getMaxFrames, Resolution, defaultFrameCount, MediaFormat } from '../state';
import { router } from '../router';
import { html } from '../ui/html';

// =========================================================================================================
// Helpers
// =========================================================================================================

/** Format a duration in seconds as `M:SS.ss`. */
function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

// =========================================================================================================
// View
// =========================================================================================================

export class AnalysisView implements View {
  private listeners: Array<() => void> = [];

  mount(container: HTMLElement): void {
    const info = state.mediaInfo!;
    const path = state.inputPath!;
    const filename = path.split(/[\\\/]/).pop() ?? path;

    const framesDisplay = info.total_frames > 0 ? String(info.total_frames) : 'unknown';

    const root = html`
      <div>
        <div class="view-header">
          <span class="section-heading">Media Analysis</span>
        </div>
        <div class="view-body" style="display:flex; flex-direction:column; gap:16px;">
          <div class="info-grid">
            <span class="info-label">File</span>
            <span class="info-value text-mono">${filename}</span>

            <span class="info-label">Format</span>
            <span class="info-value">${info.format.toUpperCase()}</span>

            <span class="info-label">Dimensions</span>
            <span class="info-value">${info.width} × ${info.height} px</span>

            <span class="info-label">Frame rate</span>
            <span class="info-value">${info.fps.toFixed(3)} fps</span>

            <span class="info-label">Total frames</span>
            <span class="info-value" id="frames-val">
              ${framesDisplay}
            </span>

            <span class="info-label">Duration</span>
            <span class="info-value">${fmtDuration(info.duration_secs)}</span>
          </div>

          <div style="margin-top: 8px;">
            <div class="field-label" style="margin-bottom:8px;">Sprite Cell Resolution</div>
            <div class="toggle-group" id="res-group">
              <button type="button" id="btn-res-128" aria-pressed="${state.resolution === Resolution.RES_128 ? 'true' : 'false'}">
                128×128 <span style="font-size: 11px; opacity: 0.7; font-weight: normal; margin-left: 4px;">(max 64 frames)</span>
              </button>
              <button type="button" id="btn-res-256" aria-pressed="${state.resolution === Resolution.RES_256 ? 'true' : 'false'}">
                256×256 <span style="font-size: 11px; opacity: 0.7; font-weight: normal; margin-left: 4px;">(max 16 frames)</span>
              </button>
            </div>
          </div>

          ${info.format === MediaFormat.GIF ? `
          <div style="margin-top: 8px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size: 13px;">
              <input type="checkbox" id="chk-dup" ${state.removeDuplicateFrames ? 'checked' : ''}>
              Remove duplicate frames
            </label>
            <p class="text-secondary" style="font-size:12px; margin-top:4px; margin-left:21px;">
              Removes identical frames to make animations more fluid.
            </p>
          </div>
          ` : ''}

          <div id="notice-container"></div>
        </div>
        <div class="view-footer">
          <button class="btn-ghost"   id="back-btn" type="button">Back</button>
          <button class="btn-primary" id="next-btn" type="button">Next</button>
        </div>
      </div>
    `;

    container.appendChild(root);

    const backBtn = root.querySelector<HTMLButtonElement>('#back-btn')!;
    const nextBtn = root.querySelector<HTMLButtonElement>('#next-btn')!;
    const framesVal = root.querySelector<HTMLElement>('#frames-val')!;
    const noticeContainer = root.querySelector<HTMLElement>('#notice-container')!;
    const btnRes128 = root.querySelector<HTMLButtonElement>('#btn-res-128')!;
    const btnRes256 = root.querySelector<HTMLButtonElement>('#btn-res-256')!;

    let needsReduction = false;

    // =========================================================================
    // UI Update Logic
    // =========================================================================

    const updateUI = () => {
      const maxFrames = getMaxFrames();
      needsReduction = info.total_frames > maxFrames;

      // Update frames badge
      framesVal.innerHTML = `
        ${framesDisplay}
        ${needsReduction ? `<span class="badge" style="margin-left:8px;border-color:var(--warn);color:var(--warn);">exceeds ${maxFrames}</span>` : ''}
      `;

      // Update notice
      if (needsReduction) {
        noticeContainer.innerHTML = `
          <div class="notice">
            This source has ${framesDisplay} frames. VRChat supports a maximum of ${maxFrames} frames for ${state.resolution}×${state.resolution} cells.
            You will need to reduce the frame count in the next step.
          </div>
        `;
      } else {
        noticeContainer.innerHTML = '';
      }

      // Update next button
      nextBtn.textContent = needsReduction ? 'Configure Reduction' : 'Choose Fit Mode';

      // Update state's default frameCount so it never exceeds the new max if we skip reduction
      state.frameCount = defaultFrameCount(info.total_frames);
    };

    const setResolution = (res: Resolution) => {
      state.resolution = res;
      btnRes128.setAttribute('aria-pressed', res === Resolution.RES_128 ? 'true' : 'false');
      btnRes256.setAttribute('aria-pressed', res === Resolution.RES_256 ? 'true' : 'false');
      updateUI();
    };

    const onRes128 = () => setResolution(Resolution.RES_128);
    const onRes256 = () => setResolution(Resolution.RES_256);

    btnRes128.addEventListener('click', onRes128);
    btnRes256.addEventListener('click', onRes256);

    // Initial render
    updateUI();

    if (info.format === MediaFormat.GIF) {
      const chkDup = root.querySelector<HTMLInputElement>('#chk-dup');
      if (chkDup) {
        const onDupChange = (e: Event) => {
          state.removeDuplicateFrames = (e.target as HTMLInputElement).checked;
        };
        chkDup.addEventListener('change', onDupChange);
        this.listeners.push(() => chkDup.removeEventListener('change', onDupChange));
      }
    }

    // =========================================================================
    // Navigation
    // =========================================================================

    const onBack = async (): Promise<void> => {
      const { DropView } = await import('./DropView');
      router.navigate(new DropView(), 0);
    };

    const onNext = async (): Promise<void> => {
      if (needsReduction) {
        const { ReductionView } = await import('./ReductionView');
        router.navigate(new ReductionView(), 2);
      } else {
        state.reductionMode = null;
        const { FitView } = await import('./FitView');
        router.navigate(new FitView(), 3);
      }
    };

    backBtn.addEventListener('click', onBack);
    nextBtn.addEventListener('click', onNext);

    // =========================================================================
    // Cleanup registration
    // =========================================================================

    this.listeners.push(
      () => btnRes128.removeEventListener('click', onRes128),
      () => btnRes256.removeEventListener('click', onRes256),
      () => backBtn.removeEventListener('click', onBack),
      () => nextBtn.removeEventListener('click', onNext),
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
