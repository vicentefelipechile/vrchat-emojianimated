// =========================================================================================================
// ANALYSIS VIEW — Step 1
// =========================================================================================================
// Displays the ffprobe results for the chosen file.
// Routes to ReductionView if total_frames > MAX_FRAMES, otherwise directly to FitView.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View }         from './View';
import { state, MAX_FRAMES } from '../state';
import { router }            from '../router';
import { html }              from '../ui/html';

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
    const info     = state.mediaInfo!;
    const path     = state.inputPath!;
    const filename = path.split(/[\\\/]/).pop() ?? path;

    const needsReduction = info.total_frames > MAX_FRAMES;
    const framesDisplay  = info.total_frames > 0 ? String(info.total_frames) : 'unknown';
    const nextLabel      = needsReduction ? 'Configure Reduction' : 'Choose Fit Mode';

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
            <span class="info-value">
              ${framesDisplay}
              ${needsReduction ? `<span class="badge" style="margin-left:8px;border-color:var(--warn);color:var(--warn);">exceeds ${MAX_FRAMES}</span>` : ''}
            </span>

            <span class="info-label">Duration</span>
            <span class="info-value">${fmtDuration(info.duration_secs)}</span>
          </div>

          ${needsReduction
            ? `<div class="notice">
                This source has ${framesDisplay} frames. VRChat supports a maximum of ${MAX_FRAMES} frames per sprite sheet.
                You will need to reduce the frame count in the next step.
              </div>`
            : ''}
        </div>
        <div class="view-footer">
          <button class="btn-ghost"   id="back-btn" type="button">Back</button>
          <button class="btn-primary" id="next-btn" type="button">${nextLabel}</button>
        </div>
      </div>
    `;

    container.appendChild(root);

    const backBtn = root.querySelector<HTMLButtonElement>('#back-btn')!;
    const nextBtn = root.querySelector<HTMLButtonElement>('#next-btn')!;

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
