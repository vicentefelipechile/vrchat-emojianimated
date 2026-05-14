// =========================================================================================================
// ROUTER
// =========================================================================================================
// ViewRouter manages the single-page navigation model.
// It owns the #app container, unmounts the current view, mounts the incoming one,
// and keeps the 6-segment step indicator bar in sync.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View } from './views/View';

// =========================================================================================================
// Types
// =========================================================================================================

/**
 * Zero-based index of the active step in the pipeline.
 *   0 = DropView       4 = OptionsView
 *   1 = AnalysisView   5 = ExportView
 *   2 = ReductionView
 *   3 = FitView
 */
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

// =========================================================================================================
// ViewRouter
// =========================================================================================================

export class ViewRouter {
  private current:     View | null  = null;
  private currentStep: StepIndex    = 0;

  /**
   * Navigate to `view` at pipeline step `step`.
   * Unmounts the currently active view, clears #app, mounts the new view,
   * and updates the step-indicator bar.
   */
  navigate(view: View, step: StepIndex): void {
    this.current?.unmount();
    const container = document.getElementById('app')!;
    container.innerHTML = '';
    this.current     = view;
    this.currentStep = step;
    this.updateStepIndicator(step);
    view.mount(container);
  }

  /** The index of the currently active step. */
  get step(): StepIndex {
    return this.currentStep;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private updateStepIndicator(activeStep: StepIndex): void {
    const segs = document.querySelectorAll<HTMLElement>('.step-seg');
    segs.forEach((seg, i) => {
      seg.classList.remove('active', 'done');
      if      (i < activeStep)  seg.classList.add('done');
      else if (i === activeStep) seg.classList.add('active');
    });
  }
}

// =========================================================================================================
// Singleton
// =========================================================================================================

export const router = new ViewRouter();
