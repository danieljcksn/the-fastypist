import { describe, expect, it } from "vitest";
import { afkFromGap, type ClockDeps, createCountdown, createIdleWatch } from "@/typing/clock";

function fakeDeps() {
  let now = 0;
  let frames: (() => void)[] = [];
  let timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 1;
  const deps: ClockDeps = {
    now: () => now,
    raf(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelRaf() {
      frames = [];
    },
    timer(callback, ms) {
      const id = nextId++;
      timers.push({ at: now + ms, run: callback, id });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancelTimer(id) {
      timers = timers.filter((t) => t.id !== (id as unknown as number));
    },
  };
  return {
    deps,
    advance(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.run();
    },
    frame() {
      const current = frames;
      frames = [];
      for (const f of current) f();
    },
    pendingFrames: () => frames.length,
  };
}

describe("countdown", () => {
  it("writes only when the integer second changes", () => {
    const f = fakeDeps();
    const seconds: number[] = [];
    const clock = createCountdown(f.deps, (s) => seconds.push(s), () => undefined);
    clock.start(3000);
    for (let i = 0; i < 40; i++) {
      f.advance(50);
      f.frame();
    }
    expect(seconds).toEqual([3, 2, 1]);
  });

  it("finishes on a frame without rAF needing the timer, and once", () => {
    const f = fakeDeps();
    let expired = 0;
    const clock = createCountdown(f.deps, () => undefined, () => expired++);
    clock.start(1000);
    f.advance(999);
    f.frame();
    expect(expired).toBe(0);
    f.advance(1);
    f.frame();
    expect(expired).toBe(1);
    f.advance(5000);
    f.frame();
    expect(expired).toBe(1);
  });

  it("finishes with no frames at all, as in a hidden tab", () => {
    const f = fakeDeps();
    let expired = 0;
    const clock = createCountdown(f.deps, () => undefined, () => expired++);
    clock.start(1000);
    f.advance(1001);
    expect(expired).toBe(1);
  });

  it("stops cleanly", () => {
    const f = fakeDeps();
    let expired = 0;
    const clock = createCountdown(f.deps, () => undefined, () => expired++);
    clock.start(1000);
    clock.stop();
    f.advance(2000);
    f.frame();
    expect(expired).toBe(0);
    expect(f.pendingFrames()).toBe(0);
  });
});

describe("idle watch", () => {
  it("fires only after the full limit since the last touch", () => {
    const f = fakeDeps();
    let idle = 0;
    const watch = createIdleWatch(f.deps, 30000, () => idle++);
    watch.touch();
    f.advance(20000);
    watch.touch();
    f.advance(20000);
    expect(idle).toBe(0);
    f.advance(10000);
    expect(idle).toBe(1);
  });

  it("stops", () => {
    const f = fakeDeps();
    let idle = 0;
    const watch = createIdleWatch(f.deps, 100, () => idle++);
    watch.touch();
    watch.stop();
    f.advance(1000);
    expect(idle).toBe(0);
  });
});

describe("afk", () => {
  it("counts a gap from 5 s", () => {
    expect(afkFromGap(4999)).toBe(0);
    expect(afkFromGap(5000)).toBe(5000);
    expect(afkFromGap(12000)).toBe(12000);
  });
});
