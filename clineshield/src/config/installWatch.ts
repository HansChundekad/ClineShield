/**
 * installWatch.ts
 *
 * Lets the sidebar notice a plugin install without "Reload Config". The
 * extension pokes this on plugin-folder changes, window focus and the view
 * becoming visible; each poke re-runs the install check until it finds the
 * plugin, then it stops. One check runs at a time; a poke during a check
 * queues a single re-check. Never throws.
 */

export interface InstallWatch {
  readonly found: boolean;
  poke(): void;
  dispose(): void;
}

export function createInstallWatch(check: () => Promise<boolean>, onFound: () => void): InstallWatch {
  let found = false;
  let disposed = false;
  let running = false;
  let again = false;

  const run = async (): Promise<void> => {
    running = true;
    try {
      do {
        again = false;
        let ok = false;
        try { ok = await check(); } catch { ok = false; }
        if (disposed) return;
        if (ok) { found = true; onFound(); return; }
      } while (again);
    } finally {
      running = false;
    }
  };

  const poke = (): void => {
    if (found || disposed) return;
    if (running) { again = true; return; }
    void run();
  };

  poke();
  return {
    get found() { return found; },
    poke,
    dispose() { disposed = true; },
  };
}
