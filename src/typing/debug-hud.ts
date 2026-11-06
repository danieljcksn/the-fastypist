const WINDOW = 200;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/** Behind ?debug=1 and imported only then: key to next-frame latency, handler cost and audio latency, for real hardware. */
export function mountHud(audio: () => { baseMs: number; outputMs: number; underruns: number | null } | null): () => void {
  const box = document.createElement("pre");
  box.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:50;margin:0;padding:8px;font:12px/1.4 monospace;background:var(--surface);color:var(--text);pointer-events:none";
  document.body.append(box);
  const toFrame: number[] = [];
  const handler: number[] = [];

  const onDown = (e: Event) => {
    const start = performance.now();
    const pressed = e.timeStamp;
    queueMicrotask(() => handler.push(performance.now() - start));
    requestAnimationFrame(() => setTimeout(() => toFrame.push(performance.now() - pressed), 0));
    if (toFrame.length > WINDOW) toFrame.shift();
    if (handler.length > WINDOW) handler.shift();
  };
  window.addEventListener("keydown", onDown, { capture: true });
  const timer = setInterval(() => {
    const frames = [...toFrame].sort((a, b) => a - b);
    const handlers = [...handler].sort((a, b) => a - b);
    const sound = audio();
    box.textContent =
      `key to frame p50 ${percentile(frames, 0.5).toFixed(1)} p95 ${percentile(frames, 0.95).toFixed(1)} ms\n` +
      `handler p95 ${percentile(handlers, 0.95).toFixed(2)} ms\n` +
      (sound ? `audio ${sound.baseMs.toFixed(0)}+${sound.outputMs.toFixed(0)} ms, underruns ${sound.underruns ?? "n/a"}` : "audio off");
  }, 500);

  return () => {
    clearInterval(timer);
    window.removeEventListener("keydown", onDown, { capture: true });
    box.remove();
  };
}
