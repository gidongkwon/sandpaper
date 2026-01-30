export type PerfSample = {
  label: string;
  start: number;
  end: number;
  duration: number;
};

export type PerfStats = {
  count: number;
  last: PerfSample | null;
  p50: number | null;
  p95: number | null;
};

type PerfDeps = {
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
};

type FpsDeps = {
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  cancelRaf?: (id: number) => void;
  setTimeout?: (cb: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
};

const defaultNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const defaultRaf = (cb: FrameRequestCallback) => {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(cb);
  }
  return globalThis.setTimeout(() => cb(defaultNow()), 16);
};

const defaultCancelRaf = (id: number) => {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
    return;
  }
  globalThis.clearTimeout(id);
};

export const getPercentile = (values: number[], percentile: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, percentile));
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(clamped * sorted.length) - 1)
  );
  return sorted[index];
};

export const createPerfTracker = (
  {
    maxSamples = 120,
    onSample
  }: { maxSamples?: number; onSample?: (sample: PerfSample) => void } = {},
  deps: PerfDeps = {}
) => {
  const now = deps.now ?? defaultNow;
  const raf = deps.raf ?? defaultRaf;
  const samples: PerfSample[] = [];

  const recordSample = (sample: PerfSample) => {
    samples.push(sample);
    if (samples.length > maxSamples) {
      samples.splice(0, samples.length - maxSamples);
    }
    onSample?.(sample);
  };

  const mark = (label: string) => {
    const start = now();
    raf(() => {
      raf(() => {
        const end = now();
        recordSample({
          label,
          start,
          end,
          duration: end - start
        });
      });
    });
  };

  const getSamples = () => samples.slice();

  const reset = () => {
    samples.length = 0;
  };

  const getStats = (): PerfStats => {
    const durations = samples.map((sample) => sample.duration);
    return {
      count: samples.length,
      last: samples.length > 0 ? samples[samples.length - 1] : null,
      p50: getPercentile(durations, 0.5),
      p95: getPercentile(durations, 0.95)
    };
  };

  return {
    mark,
    getSamples,
    getStats,
    reset
  };
};

export const createFpsMeter = (
  {
    windowMs = 1000,
    idleMs = 160,
    onUpdate
  }: { windowMs?: number; idleMs?: number; onUpdate?: (fps: number) => void } = {},
  deps: FpsDeps = {}
) => {
  const now = deps.now ?? defaultNow;
  const raf = deps.raf ?? defaultRaf;
  const cancelRaf = deps.cancelRaf ?? defaultCancelRaf;
  const setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout;
  const clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout;

  const frames: number[] = [];
  let active = false;
  let fps = 0;
  let rafId = 0;
  let idleId: number | null = null;

  const updateFps = (next: number) => {
    fps = next;
    onUpdate?.(fps);
  };

  const tick = () => {
    if (!active) {
      rafId = 0;
      return;
    }
    const stamp = now();
    frames.push(stamp);
    const cutoff = stamp - windowMs;
    while (frames.length > 0 && frames[0] < cutoff) {
      frames.shift();
    }
    const nextFps = Math.round((frames.length * 1000) / windowMs);
    if (nextFps !== fps) {
      updateFps(nextFps);
    }
    rafId = raf(tick);
  };

  const notifyScroll = () => {
    active = true;
    if (!rafId) {
      rafId = raf(tick);
    }
    if (idleId !== null) {
      clearTimeoutFn(idleId);
    }
    idleId = setTimeoutFn(() => {
      active = false;
      frames.length = 0;
      updateFps(0);
    }, idleMs);
  };

  const dispose = () => {
    active = false;
    frames.length = 0;
    if (rafId) {
      cancelRaf(rafId);
      rafId = 0;
    }
    if (idleId !== null) {
      clearTimeoutFn(idleId);
      idleId = null;
    }
  };

  return {
    notifyScroll,
    getFps: () => fps,
    dispose
  };
};
