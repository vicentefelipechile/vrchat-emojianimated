// src/ui/progress.ts — plain DOM progress bar per blueprint section 7.8
export class ProgressBar {
  private track: HTMLElement;
  private fill: HTMLElement;
  private status: HTMLElement;

  constructor() {
    this.track = document.createElement('div');
    this.track.className = 'progress-bar-track';

    this.fill = document.createElement('div');
    this.fill.className = 'progress-bar-fill';
    this.track.appendChild(this.fill);

    this.status = document.createElement('div');
    this.status.className = 'progress-status';
  }

  get elements(): [HTMLElement, HTMLElement] {
    return [this.track, this.status];
  }

  /** Update progress — percent 0–100, real value, no easing */
  setProgress(percent: number, label: string): void {
    this.fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    this.status.textContent = label;
  }

  reset(): void {
    this.fill.style.width = '0%';
    this.status.textContent = '';
  }
}
