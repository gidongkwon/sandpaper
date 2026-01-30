export type ShadowWriterOptions = {
  debounceMs?: number;
  maxDelayMs?: number;
  resolvePath: (pageId: string) => string;
  writeFile: (path: string, content: string) => Promise<void> | void;
  setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
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
  clearTimeout = globalThis.clearTimeout
}: ShadowWriterOptions): ShadowWriter => {
  const pending = new Map<string, string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxDelayTimer: ReturnType<typeof setTimeout> | null = null;

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
    clearTimers();
    await Promise.all(
      entries.map(([pageId, content]) => writeFile(resolvePath(pageId), content))
    );
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
    pending.set(pageId, content);
    scheduleFlush();
  };

  const dispose = () => {
    clearTimers();
    pending.clear();
  };

  return {
    scheduleWrite,
    flush,
    getPendingCount: () => pending.size,
    dispose
  };
};
