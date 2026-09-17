import { useEffect, useState } from "react";

/** Shared playhead for the node body and the fullscreen editor. */
export function useBlockingPlayhead(durationMs: number) {
  const dur = Math.max(1, durationMs);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlayheadMs((p) => Math.min(p, dur));
  }, [dur]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setPlayheadMs((p) => {
        const next = p + dt;
        return next >= dur ? next % dur : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, dur]);

  return {
    playheadMs,
    setPlayheadMs,
    playing,
    setPlaying,
  };
}
