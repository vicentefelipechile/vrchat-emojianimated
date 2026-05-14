// =========================================================================================================
// ENTRY POINT
// =========================================================================================================
// Bootstraps the application once the DOM is ready.
// Mounts DropView (Step 0) into the #app container via the router singleton.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import './style.css';
import { router }   from './router';
import { checkDependencies } from './ipc';

// =========================================================================================================
// Bootstrap
// =========================================================================================================

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const hasDeps = await checkDependencies();
    if (hasDeps) {
      const { DropView } = await import('./views/DropView');
      router.navigate(new DropView(), 0);
    } else {
      const { DownloadView } = await import('./views/DownloadView');
      router.navigate(new DownloadView(), 0);
    }
  } catch (e) {
    console.error("Failed to check dependencies", e);
  }
});
