// =========================================================================================================
// DOWNLOAD VIEW — step -1
// =========================================================================================================
// Shown when FFmpeg binaries are missing. Downloads and extracts them.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View } from './View';
import { html } from '../ui/html';
import { ProgressBar } from '../ui/progress';
import { router } from '../router';
import { downloadDependencies } from '../ipc';
import { listen } from '@tauri-apps/api/event';

export class DownloadView implements View {
  private listeners: Array<() => void> = [];

  public async mount(container: HTMLElement): Promise<void> {
    const el = html`
      <div>
        <div class="view-header">
          <span class="section-heading">Initial Setup</span>
        </div>
        
        <div class="view-body flex flex-col gap-16">
          <div class="notice">
            Downloading FFmpeg for video processing (approx 110MB).<br>
            This is only needed once.
          </div>
          
          <div id="dl-progress-container" class="mt-8"></div>
        </div>

        <div class="view-footer" id="dl-actions" style="display: none;">
           <button class="btn-ghost danger" id="btn-retry" style="display: none;" type="button">Retry Download</button>
           <button class="btn-primary" id="btn-continue" style="display: none;" type="button">Start Application</button>
        </div>
      </div>
    `;

    container.appendChild(el);

    const progressContainer = el.querySelector('#dl-progress-container') as HTMLElement;
    const btnContinue = el.querySelector('#btn-continue') as HTMLButtonElement;
    const btnRetry = el.querySelector('#btn-retry') as HTMLButtonElement;
    
    const progress = new ProgressBar();
    progressContainer.appendChild(progress.elements[0]);
    progressContainer.appendChild(progress.elements[1]);

    const unlisten = await listen<{ percentage: number; status: string }>('download_progress', (e) => {
      progress.setProgress(e.payload.percentage, e.payload.status);
    });
    this.listeners.push(unlisten);

    const onContinue = () => {
      import('./DropView').then(m => router.navigate(new m.DropView(), 0));
    };
    btnContinue.addEventListener('click', onContinue);
    this.listeners.push(() => btnContinue.removeEventListener('click', onContinue));

    const onRetry = () => {
      btnRetry.style.display = 'none';
      progress.reset();
      this.startDownload(progress, btnContinue, btnRetry);
    };
    btnRetry.addEventListener('click', onRetry);
    this.listeners.push(() => btnRetry.removeEventListener('click', onRetry));

    this.startDownload(progress, btnContinue, btnRetry);
  }

  private async startDownload(progress: ProgressBar, btnContinue: HTMLButtonElement, btnRetry: HTMLButtonElement) {
    const actionsBlock = document.getElementById('dl-actions');
    try {
      await downloadDependencies();
      if (actionsBlock) actionsBlock.style.display = 'flex';
      btnContinue.style.display = 'block';
    } catch (e) {
      progress.setProgress(0, `Error: ${e}`);
      if (actionsBlock) actionsBlock.style.display = 'flex';
      btnRetry.style.display = 'block';
    }
  }

  public unmount(): void {
    for (const fn of this.listeners) fn();
    this.listeners = [];
  }
}
