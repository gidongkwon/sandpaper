import { describe, expect, it } from "vitest";
import { createFpsMeter, createPerfTracker, getPercentile } from "./perf";

describe("getPercentile", () => {
  it("returns null for empty samples", () => {
    expect(getPercentile([], 0.5)).toBeNull();
  });

  it("calculates percentiles on unsorted samples", () => {
    expect(getPercentile([5, 1, 4, 3, 2], 0.5)).toBe(3);
    expect(getPercentile([5, 1, 4, 3, 2], 0.95)).toBe(5);
  });
});

describe("createPerfTracker", () => {
  it("records a sample after two animation frames", () => {
    let now = 0;
    const rafQueue: FrameRequestCallback[] = [];
    const raf = (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };

    const tracker = createPerfTracker(
      { maxSamples: 5 },
      {
        now: () => now,
        raf
      }
    );

    tracker.mark("input");

    const runFrame = (delta: number) => {
      const cb = rafQueue.shift();
      if (!cb) return;
      now += delta;
      cb(now);
    };

    runFrame(8);
    runFrame(8);

    const samples = tracker.getSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].duration).toBe(16);
    expect(samples[0].label).toBe("input");
  });

  it("keeps the most recent samples", () => {
    let now = 0;
    const rafQueue: FrameRequestCallback[] = [];
    const raf = (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };

    const tracker = createPerfTracker(
      { maxSamples: 2 },
      {
        now: () => now,
        raf
      }
    );

    const runFrame = () => {
      const cb = rafQueue.shift();
      if (!cb) return;
      now += 8;
      cb(now);
    };

    tracker.mark("first");
    runFrame();
    runFrame();
    tracker.mark("second");
    runFrame();
    runFrame();
    tracker.mark("third");
    runFrame();
    runFrame();

    const samples = tracker.getSamples();
    expect(samples).toHaveLength(2);
    expect(samples[0].label).toBe("second");
    expect(samples[1].label).toBe("third");
  });
});

describe("createFpsMeter", () => {
  it("estimates FPS during active scrolling and resets after idle", () => {
    let now = 0;
    const rafQueue: FrameRequestCallback[] = [];
    const raf = (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };

    let timeoutId = 0;
    const timeouts = new Map<number, { time: number; cb: () => void }>();
    const setTimeoutFn = (cb: () => void, ms: number) => {
      timeoutId += 1;
      timeouts.set(timeoutId, { time: now + ms, cb });
      return timeoutId;
    };
    const clearTimeoutFn = (id: number) => {
      timeouts.delete(id);
    };

    const advanceTime = (delta: number) => {
      now += delta;
      for (const [id, entry] of [...timeouts.entries()]) {
        if (entry.time <= now) {
          timeouts.delete(id);
          entry.cb();
        }
      }
    };

    const meter = createFpsMeter(
      { windowMs: 160, idleMs: 50 },
      {
        now: () => now,
        raf,
        setTimeout: setTimeoutFn,
        clearTimeout: clearTimeoutFn
      }
    );

    meter.notifyScroll();

    for (let i = 0; i < 10; i += 1) {
      const cb = rafQueue.shift();
      if (!cb) break;
      now += 16;
      cb(now);
    }

    expect(meter.getFps()).toBe(63);

    advanceTime(60);
    expect(meter.getFps()).toBe(0);
  });
});
