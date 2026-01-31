export type ShadowWriterOptions = {
  debounceMs?: number;
  maxDelayMs?: number;
  resolvePath: (pageId: string) => string;
  writeFile: (path: string, content: string) => Promise<void> | void;
  setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  onPendingChange?: (pendingCount: number) => void;
};

export type ShadowWriter = {
  scheduleWrite: (pageId: string, content: string) => void;
  flush: () => Promise<void>;
  getPendingCount: () => number;
  dispose: () => void;
};

export const createShadowWriter = ({
  debounceMs = 120,
  maxDelayMs = 1000,
  resolvePath,
  writeFile,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  onPendingChange
}: ShadowWriterOptions): ShadowWriter => {
  const pending = new Map<string, string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPendingCount = 0;

  const notifyPendingChange = () => {
    if (!onPendingChange) return;
    if (pending.size === lastPendingCount) return;
    lastPendingCount = pending.size;
    onPendingChange(pending.size);
  };

  const clearTimers = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxDelayTimer) {
      clearTimeout(maxDelayTimer);
      maxDelayTimer = null;
    }
  };

  const flush = async () => {
    if (pending.size === 0) {
      clearTimers();
      return;
    }
    const entries = Array.from(pending.entries());
    pending.clear();
    notifyPendingChange();
    clearTimers();
    const failures: Array<[string, string]> = [];
    await Promise.all(
      entries.map(async ([pageId, content]) => {
        try {
          await writeFile(resolvePath(pageId), content);
        } catch {
          failures.push([pageId, content]);
        }
      })
    );

    if (failures.length > 0) {
      for (const [pageId, content] of failures) {
        if (!pending.has(pageId)) {
          pending.set(pageId, content);
        }
      }
      notifyPendingChange();
      scheduleFlush();
    }
  };

  const scheduleFlush = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      void flush();
    }, debounceMs);

    if (!maxDelayTimer) {
      maxDelayTimer = setTimeout(() => {
        void flush();
      }, maxDelayMs);
    }
  };

  const scheduleWrite = (pageId: string, content: string) => {
    const beforeSize = pending.size;
    pending.set(pageId, content);
    if (pending.size !== beforeSize) {
      notifyPendingChange();
    }
    scheduleFlush();
  };

  const dispose = () => {
    clearTimers();
    pending.clear();
    notifyPendingChange();
  };

  return {
    scheduleWrite,
    flush,
    getPendingCount: () => pending.size,
    dispose
  };
};
