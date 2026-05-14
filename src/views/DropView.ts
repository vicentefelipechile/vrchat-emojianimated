// =========================================================================================================
// DROP VIEW — Step 0
// =========================================================================================================
// Entry point of the pipeline. Accepts a file via OS drag-and-drop (Tauri native event) or
// the file-picker dialog. Runs `analyze_media` and navigates to AnalysisView on success.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import type { View }                           from './View';
import { state, defaultFrameCount, MAX_FRAMES } from '../state';
import { router }                              from '../router';
import { analyzeMedia, openFileDialog }        from '../ipc';
import { html }                                from '../ui/html';
import { getCurrentWebview }                   from '@tauri-apps/api/webview';

// =========================================================================================================
// Constants
// =========================================================================================================

/** File extensions accepted by this tool (lower-case, without the leading dot). */
const ACCEPTED_EXTENSIONS = ['gif', 'mp4', 'webm', 'mov', 'avi', 'mkv'] as const;

/** How long (ms) to suppress duplicate Tauri drop events for the same path. */
const DROP_DEBOUNCE_MS = 500;

// =========================================================================================================
// Helpers
// =========================================================================================================

/** Extract the lower-case extension from a file path, or an empty string if none. */
function getExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

/** Extract the filename stem (no directory, no extension) from an OS path. */
function getStem(path: string): string {
  return path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'output';
}

/** Return true if `ext` is in the accepted list. */
function isAccepted(ext: string): ext is typeof ACCEPTED_EXTENSIONS[number] {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

// =========================================================================================================
// View
// =========================================================================================================

export class DropView implements View {
  private listeners:     Array<() => void> = [];
  private tauriUnlisten: (() => void) | null = null;

  mount(container: HTMLElement): void {
    const root = html`
      <div>
        <div class="view-header">
          <span class="section-heading">Input</span>
        </div>
        <div class="view-body" style="padding: 0;">
          <div class="drop-zone" id="drop-zone" tabindex="0" role="button" aria-label="Drop a GIF or video file here">
            <i class="drop-zone-icon" aria-hidden="true">&#x25A4;</i>
            <span class="drop-zone-label">Drop a GIF or video file here</span>
            <span class="drop-zone-ext">${ACCEPTED_EXTENSIONS.map(e => `.${e}`).join(' &nbsp;·&nbsp; ')}</span>
            <button class="drop-zone-pick" id="pick-btn" type="button">or click to browse</button>
          </div>
        </div>
        <div id="drop-error" style="display:none; padding: 0 16px 16px;">
          <div class="notice error" id="drop-error-msg"></div>
        </div>
      </div>
    `;

    container.appendChild(root);

    const zone     = root.querySelector<HTMLElement>('#drop-zone')!;
    const pickBtn  = root.querySelector<HTMLButtonElement>('#pick-btn')!;
    const errorBox = root.querySelector<HTMLElement>('#drop-error')!;
    const errorMsg = root.querySelector<HTMLElement>('#drop-error-msg')!;

    // =========================================================================
    // Error helpers
    // =========================================================================

    const showError = (msg: string): void => {
      errorMsg.textContent   = msg;
      errorBox.style.display = 'block';
    };

    const hideError = (): void => {
      errorBox.style.display = 'none';
    };

    // =========================================================================
    // File handler — validates extension, runs analyze_media, updates state
    // =========================================================================

    const handleFile = async (path: string): Promise<void> => {
      const ext = getExtension(path);

      if (!isAccepted(ext)) {
        showError(`Unsupported format: .${ext}. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`);
        return;
      }

      hideError();
      zone.classList.add('drag-over');

      try {
        state.inputPath  = path;
        const info       = await analyzeMedia(path);
        state.mediaInfo  = info;
        state.outputName = getStem(path);
        state.frameCount = defaultFrameCount(info.total_frames);
        state.fps        = Math.round(info.fps) || MAX_FRAMES;

        const { AnalysisView } = await import('./AnalysisView');
        router.navigate(new AnalysisView(), 1);
      } catch (e) {
        showError(`Failed to analyze file: ${(e as Error)?.message ?? String(e)}`);
        zone.classList.remove('drag-over');
      }
    };

    // =========================================================================
    // Tauri native drag-drop
    // Delivers real OS file paths. HTML5 events below are for visual feedback only.
    // =========================================================================

    let lastDropPath = ''; // debounce guard — Tauri may fire drop twice

    getCurrentWebview().onDragDropEvent((event) => {
      const type = event.payload.type;

      if (type === 'over' || type === 'enter') {
        zone.classList.add('drag-over');
      } else if (type === 'leave') {
        zone.classList.remove('drag-over');
      } else if (type === 'drop') {
        zone.classList.remove('drag-over');
        const paths = (event.payload as { paths?: string[] }).paths;
        if (paths && paths.length > 0 && paths[0] !== lastDropPath) {
          lastDropPath = paths[0];
          setTimeout(() => { lastDropPath = ''; }, DROP_DEBOUNCE_MS);
          handleFile(paths[0]);
        }
      }
    })
      .then((unlisten) => { this.tauriUnlisten = unlisten; })
      .catch(() => { /* Not running inside Tauri — silently skip. */ });

    // =========================================================================
    // HTML5 drag-over / drag-leave (visual feedback only)
    // =========================================================================

    const onDragover  = (e: Event): void => { e.preventDefault(); zone.classList.add('drag-over'); };
    const onDragleave = ():          void => { zone.classList.remove('drag-over'); };
    const onDrop      = (e: Event): void => { e.preventDefault(); zone.classList.remove('drag-over'); };

    zone.addEventListener('dragover',  onDragover);
    zone.addEventListener('dragleave', onDragleave);
    zone.addEventListener('drop',      onDrop);

    // =========================================================================
    // File picker button
    // =========================================================================

    const onPickClick = async (e: Event): Promise<void> => {
      e.stopPropagation();
      try {
        const path = await openFileDialog();
        if (path) await handleFile(path);
      } catch (err) {
        showError(`Could not open file dialog: ${String(err)}`);
      }
    };

    pickBtn.addEventListener('click', onPickClick);

    // =========================================================================
    // Cleanup registration
    // =========================================================================

    this.listeners.push(
      () => zone.removeEventListener('dragover',  onDragover),
      () => zone.removeEventListener('dragleave', onDragleave),
      () => zone.removeEventListener('drop',      onDrop),
      () => pickBtn.removeEventListener('click',  onPickClick),
    );
  }

  // =========================================================================================================
  // Lifecycle
  // =========================================================================================================

  unmount(): void {
    this.tauriUnlisten?.();
    this.tauriUnlisten = null;
    this.listeners.forEach(fn => fn());
    this.listeners = [];
  }
}
