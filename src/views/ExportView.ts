// =========================================================================================================
// EXPORT VIEW — Step 5
// =========================================================================================================
// Orchestrates the three-phase export pipeline:
//   1. extract_frames  → runs FFmpeg, writes frame PNGs to a temp dir.
//   2. save dialog     → asks the user where to save the sprite sheet.
//   3. assemble_sheet  → stitches frames into a 1024×1024 PNG, returns base64 preview.
//
// After assembly the view shows an animated canvas preview (128×128 window into the sprite sheet)
// and replaces the footer with a "Convert Another File" button.
//
// The `aborted` flag guards the async pipeline against navigating away mid-export.
// cleanup_temp() is always called on success and on error.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { extractFrames, assembleSheet, cleanupTemp, saveFileDialog } from '../ipc';
import type { View } from './View';
import { state, FitMode, buildOutputFilename } from '../state';
import { router } from '../router';
import { html } from '../ui/html';
import { ProgressBar } from '../ui/progress';

// =========================================================================================================
// Constants
// =========================================================================================================

/** Sprite sheet grid size — varies based on resolution. */

/** Progress percentages reported at each pipeline milestone. */
const PROGRESS = {
  STARTED:   5,
  EXTRACTED: 60,
  ASSEMBLED: 75,
  CLEANUP:   95,
  DONE:      100,
} as const;

// =========================================================================================================
// Helpers
// =========================================================================================================

/** Format a byte count as a human-readable string (B / KB / MB). */
function fmtBytes(bytes: number): string {
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// =========================================================================================================
// View
// =========================================================================================================

export class ExportView implements View {
  private listeners: Array<() => void> = [];
  private aborted = false; // set true in unmount() to bail any in-flight async steps

  mount(container: HTMLElement): void {
    const filename = buildOutputFilename();

    const root = html`
      <div>
        <div class="view-header">
          <span class="section-heading">Export</span>
        </div>
        <div class="view-body" style="display:flex; flex-direction:column; gap:16px;" id="export-body">

          <div class="info-grid">
            <span class="info-label">Output file</span>
            <span class="info-value text-mono">${filename}</span>
            <span class="info-label">Frames</span>
            <span class="info-value">${state.frameCount}</span>
            <span class="info-label">FPS</span>
            <span class="info-value">${state.fps}</span>
            <span class="info-label">Fit mode</span>
            <span class="info-value">${state.fitMode}</span>
          </div>

          <hr class="divider" />

          <div id="progress-section" style="display:none; flex-direction:column; gap:0;"></div>
          <div id="result-section"   style="display:none; flex-direction:column; gap:16px;"></div>
          <div id="error-section"    style="display:none;"></div>

        </div>
        <div class="view-footer" id="export-footer">
          <button class="btn-ghost"   id="back-btn"  type="button">Back</button>
          <button class="btn-primary" id="start-btn" type="button">Generate</button>
        </div>
      </div>
    `;

    container.appendChild(root);

    const progressSection = root.querySelector<HTMLElement>('#progress-section')!;
    const resultSection   = root.querySelector<HTMLElement>('#result-section')!;
    const errorSection    = root.querySelector<HTMLElement>('#error-section')!;
    const footer          = root.querySelector<HTMLElement>('#export-footer')!;
    const backBtn         = root.querySelector<HTMLButtonElement>('#back-btn')!;
    const startBtn        = root.querySelector<HTMLButtonElement>('#start-btn')!;

    const progress = new ProgressBar();
    const [track, status] = progress.elements;
    progressSection.appendChild(track);
    progressSection.appendChild(status);

    // =========================================================================
    // Error display
    // =========================================================================

    const showError = (msg: string): void => {
      errorSection.innerHTML = '';
      const notice = document.createElement('div');
      notice.className   = 'notice error';
      notice.textContent = msg;
      errorSection.appendChild(notice);
      errorSection.style.display = 'block';
    };

    // =========================================================================
    // Export pipeline
    // =========================================================================

    const onStart = async (): Promise<void> => {
      startBtn.disabled = true;
      backBtn.disabled  = true;
      errorSection.style.display  = 'none';
      progressSection.style.display = 'flex';
      this.aborted = false;

      try {
        // Phase 1: Extract frames via FFmpeg
        progress.setProgress(PROGRESS.STARTED, 'Extracting frames…');

        const CELL_SIZE = state.resolution;
        const SHEET_COLS = 1024 / CELL_SIZE;

        const info   = state.mediaInfo!;
        const frameW = info.width  ?? CELL_SIZE * 2;
        const frameH = info.height ?? CELL_SIZE * 2;

        // For focus mode, pre-compute clamped crop offsets (blueprint §IPC):
        //   crop_x = clamp(anchor_x - (CELL_SIZE/2), 0, frame_w - CELL_SIZE)
        let cropX: number | undefined;
        let cropY: number | undefined;
        if (state.fitMode === FitMode.FOCUS) {
          const ax = state.anchorX ?? Math.floor(frameW / 2);
          const ay = state.anchorY ?? Math.floor(frameH / 2);
          cropX = Math.max(0, Math.min(ax - CELL_SIZE / 2, frameW - CELL_SIZE));
          cropY = Math.max(0, Math.min(ay - CELL_SIZE / 2, frameH - CELL_SIZE));
        }

        const extractResult = await extractFrames({
          input_path:     state.inputPath!,
          frame_count:    state.frameCount,
          target_fps:     state.fps,
          fit_mode:       state.fitMode,
          anchor_x:       cropX,
          anchor_y:       cropY,
          frame_width:    frameW,
          frame_height:   frameH,
          reduction_mode: state.reductionMode ?? undefined,
          duration_secs:  info.duration_secs ?? 0,
          remove_duplicates: state.removeDuplicateFrames,
          cell_size:      CELL_SIZE,
        });

        if (this.aborted) return;
        state.tempDir = extractResult.temp_dir;

        // Update frame count if mpdecimate removed frames, so filename is accurate
        if (extractResult.actual_count !== state.frameCount) {
          state.frameCount = extractResult.actual_count;
        }

        const suggestedFilename = buildOutputFilename();

        // Phase 2: Ask where to save
        progress.setProgress(PROGRESS.EXTRACTED, `Extracted ${extractResult.actual_count} frames. Choose save location…`);

        const savePath = await saveFileDialog(suggestedFilename);
        if (!savePath || this.aborted) {
          progress.reset();
          progressSection.style.display = 'none';
          startBtn.disabled = false;
          backBtn.disabled  = false;
          return;
        }

        // Phase 3: Assemble sprite sheet
        progress.setProgress(PROGRESS.ASSEMBLED, 'Assembling 1024×1024 sprite sheet…');

        const assembleResult = await assembleSheet({
          temp_dir:    extractResult.temp_dir,
          frame_count: extractResult.actual_count,
          output_path: savePath,
          cell_size:   CELL_SIZE,
          noise_fgsm:      state.noiseFgsm,
          noise_high_freq: state.noiseHighFreq,
          noise_sparse:    state.noiseSparse,
          noise_luma:      state.noiseLuma,
        });

        progress.setProgress(PROGRESS.CLEANUP, 'Cleaning up temporary files…');
        await cleanupTemp(extractResult.temp_dir);
        state.tempDir = null;

        progress.setProgress(PROGRESS.DONE, 'Done.');

        // =====================================================================
        // Result UI — animated canvas preview
        // =====================================================================

        resultSection.innerHTML = '';

        const previewWrap = document.createElement('div');
        previewWrap.style.cssText = [
          'width:100%',
          'aspect-ratio:1/1',
          'background:repeating-conic-gradient(#2a2a2a 0% 25%,#1e1e1e 0% 50%) 0 0/16px 16px',
          'border:1px solid var(--border)',
          'overflow:hidden',
          'position:relative',
        ].join(';');

        const canvas = document.createElement('canvas');
        canvas.width  = CELL_SIZE;
        canvas.height = CELL_SIZE;
        canvas.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated;';
        previewWrap.appendChild(canvas);
        resultSection.appendChild(previewWrap);

        // Animate sprite sheet cells on the canvas from the base64 PNG.
        const sheetImg = new Image();
        let animFrameId: number;

        sheetImg.onload = () => {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          let currentFrame  = 0;
          const totalFrames = extractResult.actual_count;
          const frameDuration = 1000 / state.fps;
          let lastTime = performance.now();

          const draw = (time: number): void => {
            animFrameId = requestAnimationFrame(draw);
            const delta = time - lastTime;

            if (delta >= frameDuration) {
              lastTime = time - (delta % frameDuration);
              ctx.clearRect(0, 0, CELL_SIZE, CELL_SIZE);

              const col = currentFrame % SHEET_COLS;
              const row = Math.floor(currentFrame / SHEET_COLS);
              ctx.drawImage(sheetImg, col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE, 0, 0, CELL_SIZE, CELL_SIZE);

              currentFrame = (currentFrame + 1) % totalFrames;
            }
          };

          animFrameId = requestAnimationFrame(draw);
        };

        sheetImg.src = `data:image/png;base64,${assembleResult.preview_base64}`;
        this.listeners.push(() => { if (animFrameId) cancelAnimationFrame(animFrameId); });

        // Result metadata row
        const resultEl = document.createElement('div');
        resultEl.className = 'export-result';
        resultEl.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="section-heading">Complete</span>
            <span class="badge accent">${fmtBytes(assembleResult.file_size_bytes)}</span>
          </div>
          <div class="export-result-path">${assembleResult.output_path}</div>
          <p class="text-secondary" style="font-size:12px;">
            1024×1024 RGBA PNG · ${state.frameCount} frames · ${state.fps} fps
          </p>
        `;
        resultSection.appendChild(resultEl);
        resultSection.style.display = 'flex';

        // =====================================================================
        // Footer — replace with post-export actions
        // =====================================================================

        footer.innerHTML = '';

        const newFileBtn = document.createElement('button');
        newFileBtn.className   = 'btn-primary';
        newFileBtn.textContent = 'Convert Another File';
        newFileBtn.addEventListener('click', async () => {
          const { resetState } = await import('../state');
          resetState();
          const { DropView } = await import('./DropView');
          router.navigate(new DropView(), 0);
        });

        const backToOptionsBtn = document.createElement('button');
        backToOptionsBtn.className   = 'btn-ghost';
        backToOptionsBtn.textContent = 'Back to Options';
        backToOptionsBtn.addEventListener('click', onBack);

        footer.appendChild(backToOptionsBtn);
        footer.appendChild(newFileBtn);

      } catch (e) {
        // Always attempt temp cleanup on failure.
        if (state.tempDir) {
          cleanupTemp(state.tempDir).catch(() => {});
          state.tempDir = null;
        }
        progress.setProgress(0, '');
        progressSection.style.display = 'none';
        showError(`Export failed: ${(e as Error)?.message ?? String(e)}`);
        startBtn.disabled = false;
        backBtn.disabled  = false;
      }
    };

    // =========================================================================
    // Navigation
    // =========================================================================

    const onBack = async (): Promise<void> => {
      const { OptionsView } = await import('./OptionsView');
      router.navigate(new OptionsView(), 4);
    };

    backBtn.addEventListener('click',  onBack);
    startBtn.addEventListener('click', onStart);

    // =========================================================================
    // Cleanup registration
    // =========================================================================

    this.listeners.push(
      () => backBtn.removeEventListener('click',  onBack),
      () => startBtn.removeEventListener('click', onStart),
    );
  }

  // =========================================================================================================
  // Lifecycle
  // =========================================================================================================

  unmount(): void {
    this.aborted = true; // signals in-flight async steps to bail
    this.listeners.forEach(fn => fn());
    this.listeners = [];
  }
}
