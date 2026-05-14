// =========================================================================================================
// REDUCTION VIEW — Step 2 (conditional)
// =========================================================================================================
// Shown only when source total_frames > MAX_FRAMES. Lets the user pick a reduction strategy:
//   Trim        → keep the first N or last N frames (fast, no quality loss).
//   Interpolate → motion-blend the full animation into exactly MAX_FRAMES frames (slower).
// The selected strategy is written to state.reductionMode before navigating to FitView.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View }                          from './View';
import { state, MAX_FRAMES, ReductionMode }   from '../state';
import { router }                             from '../router';
import { html }                               from '../ui/html';

// =========================================================================================================
// Types
// =========================================================================================================

/** Simplified method key used locally to drive the method toggle UI. */
type MethodKey = 'trim' | 'interp';

// =========================================================================================================
// View
// =========================================================================================================

export class ReductionView implements View {
  private listeners: Array<() => void> = [];

  mount(container: HTMLElement): void {
    const totalFrames = state.mediaInfo!.total_frames;

    // Apply default selection on first visit.
    if (!state.reductionMode) state.reductionMode = ReductionMode.TRIM_START;

    const root = html`
      <div>
        <div class="view-header">
          <span class="section-heading">Frame Reduction</span>
        </div>
        <div class="view-body" style="display:flex; flex-direction:column; gap:16px;">
          <p class="text-secondary">
            Source has <strong style="color:var(--text-primary)">${totalFrames}</strong> frames.
            Maximum is <strong style="color:var(--text-primary)">${MAX_FRAMES}</strong>.
          </p>

          <div>
            <div class="field-label" style="margin-bottom:8px;">Reduction method</div>
            <div class="toggle-group" id="method-group">
              <button type="button" id="btn-trim"   aria-pressed="true">Trim</button>
              <button type="button" id="btn-interp" aria-pressed="false">Interpolate</button>
            </div>
          </div>

          <hr class="divider" />

          <div id="trim-panel">
            <div>
              <div class="field-label" style="margin-bottom:8px;">Keep which end?</div>
              <div class="toggle-group" id="trim-group">
                <button type="button" id="btn-start" aria-pressed="true">Start</button>
                <button type="button" id="btn-end"   aria-pressed="false">End</button>
              </div>
            </div>
            <p class="text-secondary mt-8">Fast. No quality loss. Only covers part of the animation.</p>
          </div>

          <div id="interp-panel" style="display:none;">
            <p class="text-secondary">
              Blend <strong style="color:var(--text-primary)">${totalFrames}</strong>
              → <strong style="color:var(--text-primary)">${MAX_FRAMES}</strong> frames using motion interpolation.
            </p>
            <p class="text-secondary mt-8">Slower (~10–30 s). Covers the full animation duration.</p>
          </div>
        </div>
        <div class="view-footer">
          <button class="btn-ghost"   id="back-btn" type="button">Back</button>
          <button class="btn-primary" id="next-btn" type="button">Choose Fit Mode</button>
        </div>
      </div>
    `;

    container.appendChild(root);

    const btnTrim    = root.querySelector<HTMLButtonElement>('#btn-trim')!;
    const btnInterp  = root.querySelector<HTMLButtonElement>('#btn-interp')!;
    const btnStart   = root.querySelector<HTMLButtonElement>('#btn-start')!;
    const btnEnd     = root.querySelector<HTMLButtonElement>('#btn-end')!;
    const trimPanel  = root.querySelector<HTMLElement>('#trim-panel')!;
    const interpPanel = root.querySelector<HTMLElement>('#interp-panel')!;
    const backBtn    = root.querySelector<HTMLButtonElement>('#back-btn')!;
    const nextBtn    = root.querySelector<HTMLButtonElement>('#next-btn')!;

    // =========================================================================
    // State mutators
    // =========================================================================

    const setMethod = (method: MethodKey): void => {
      const isTrim = method === 'trim';

      btnTrim.setAttribute('aria-pressed',   isTrim ? 'true' : 'false');
      btnInterp.setAttribute('aria-pressed', isTrim ? 'false' : 'true');

      trimPanel.style.display       = isTrim ? 'flex' : 'none';
      trimPanel.style.flexDirection = 'column';
      trimPanel.style.gap           = '8px';
      interpPanel.style.display     = isTrim ? 'none' : 'block';

      if (!isTrim) {
        state.reductionMode = ReductionMode.INTERPOLATE;
      } else {
        // Preserve the current start/end sub-selection.
        const keepEnd       = btnEnd.getAttribute('aria-pressed') === 'true';
        state.reductionMode = keepEnd ? ReductionMode.TRIM_END : ReductionMode.TRIM_START;
      }
    };

    const setTrimEnd = (keepEnd: boolean): void => {
      btnStart.setAttribute('aria-pressed', keepEnd ? 'false' : 'true');
      btnEnd.setAttribute('aria-pressed',   keepEnd ? 'true'  : 'false');
      state.reductionMode = keepEnd ? ReductionMode.TRIM_END : ReductionMode.TRIM_START;
    };

    // Restore UI to match current state on re-mount.
    if (state.reductionMode === ReductionMode.INTERPOLATE) {
      setMethod('interp');
    } else {
      setMethod('trim');
      setTrimEnd(state.reductionMode === ReductionMode.TRIM_END);
    }

    // =========================================================================
    // Event handlers
    // =========================================================================

    const onTrim   = (): void => setMethod('trim');
    const onInterp = (): void => setMethod('interp');
    const onStart  = (): void => setTrimEnd(false);
    const onEnd    = (): void => setTrimEnd(true);

    btnTrim.addEventListener('click',   onTrim);
    btnInterp.addEventListener('click', onInterp);
    btnStart.addEventListener('click',  onStart);
    btnEnd.addEventListener('click',    onEnd);

    // =========================================================================
    // Navigation
    // =========================================================================

    const onBack = async (): Promise<void> => {
      const { AnalysisView } = await import('./AnalysisView');
      router.navigate(new AnalysisView(), 1);
    };

    const onNext = async (): Promise<void> => {
      const { FitView } = await import('./FitView');
      router.navigate(new FitView(), 3);
    };

    backBtn.addEventListener('click', onBack);
    nextBtn.addEventListener('click', onNext);

    // =========================================================================
    // Cleanup registration
    // =========================================================================

    this.listeners.push(
      () => btnTrim.removeEventListener('click',   onTrim),
      () => btnInterp.removeEventListener('click', onInterp),
      () => btnStart.removeEventListener('click',  onStart),
      () => btnEnd.removeEventListener('click',    onEnd),
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
