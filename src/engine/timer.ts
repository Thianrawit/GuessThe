/* ──────────────────────────────────────────────
   Timer Utilities
   ────────────────────────────────────────────── */

/**
 * Visual countdown (3, 2, 1) with callbacks per tick
 */
export function countdown(
  seconds: number,
  onTick: (remaining: number) => void,
  onComplete: () => void
): { cancel: () => void } {
  let remaining = seconds;
  let cancelled = false;

  onTick(remaining);

  const interval = setInterval(() => {
    if (cancelled) return;
    remaining--;
    if (remaining > 0) {
      onTick(remaining);
    } else {
      clearInterval(interval);
      onComplete();
    }
  }, 1000);

  return {
    cancel: () => {
      cancelled = true;
      clearInterval(interval);
    },
  };
}

/**
 * Guess timer — fires onTimeout when time runs out
 */
export function startGuessTimer(
  durationMs: number,
  onTimeout: () => void
): { cancel: () => void } {
  const timer = setTimeout(onTimeout, durationMs);
  return {
    cancel: () => clearTimeout(timer),
  };
}

/**
 * Wait for a specific duration (Promise-based)
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
