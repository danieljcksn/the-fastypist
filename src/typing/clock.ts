// A gap this long is someone away from the keyboard. A starting threshold from the engine report, to tune with data.
export const AFK_GAP_MS = 5_000;

// Time mode has its own end; a words run left alone needs one, or replay's too-long limit is its only exit.
export const WORDS_IDLE_ABORT_MS = 30_000;

export interface ClockDeps {
  now(): number;
  raf(callback: () => void): number;
  cancelRaf(id: number): void;
  timer(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  cancelTimer(id: ReturnType<typeof setTimeout>): void;
}

export const BROWSER_CLOCK: ClockDeps = {
  now: () => performance.now(),
  raf: (callback) => requestAnimationFrame(callback),
  cancelRaf: (id) => cancelAnimationFrame(id),
  timer: (callback, ms) => setTimeout(callback, ms),
  cancelTimer: (id) => clearTimeout(id),
};

export interface Countdown {
  start(deadline: number): void;
  stop(): void;
}

/** Arithmetic on a deadline, never a tick count: re-armed setInterval ran 15 to 214 ms late over 8 ticks. */
export function createCountdown(deps: ClockDeps, onSecond: (secondsLeft: number) => void, onExpire: () => void): Countdown {
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline = 0;
  let shown = -1;

  function stop() {
    if (frame !== null) deps.cancelRaf(frame);
    if (timer !== null) deps.cancelTimer(timer);
    frame = null;
    timer = null;
    shown = -1;
  }

  function check(): boolean {
    const left = deadline - deps.now();
    if (left <= 0) {
      stop();
      onExpire();
      return true;
    }
    const seconds = Math.ceil(left / 1000);
    if (seconds !== shown) {
      shown = seconds;
      onSecond(seconds);
    }
    return false;
  }

  function onFrame() {
    frame = null;
    if (!check()) frame = deps.raf(onFrame);
  }

  return {
    start(at) {
      stop();
      deadline = at;
      if (check()) return;
      frame = deps.raf(onFrame);
      // rAF stops in a hidden tab and can lag under load. The timer guarantees the end still happens.
      timer = deps.timer(() => {
        timer = null;
        check();
      }, Math.ceil(deadline - deps.now()) + 1);
    },
    stop,
  };
}

export interface IdleWatch {
  touch(): void;
  stop(): void;
}

export function createIdleWatch(deps: ClockDeps, limitMs: number, onIdle: () => void): IdleWatch {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTouch = 0;

  function arm(ms: number) {
    timer = deps.timer(() => {
      timer = null;
      const left = lastTouch + limitMs - deps.now();
      if (left <= 0) onIdle();
      else arm(left);
    }, ms);
  }

  return {
    touch() {
      lastTouch = deps.now();
      if (timer === null) arm(limitMs);
    },
    stop() {
      if (timer !== null) deps.cancelTimer(timer);
      timer = null;
    },
  };
}

/** What a pause adds to afkMs: the whole gap once it reaches the threshold, nothing below it. */
export function afkFromGap(gapMs: number): number {
  return gapMs >= AFK_GAP_MS ? gapMs : 0;
}
