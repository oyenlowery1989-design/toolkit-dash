import { useCallback, useEffect, useRef } from "react";

/**
 * Abortable async runs: starting a new run aborts the previous one;
 * unmount aborts the current one. The callback receives the run's own
 * controller — check THAT signal after awaits, never a shared ref.
 */
export function useAbortableRun() {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        return await fn(controller.signal);
      } catch (e) {
        if (controller.signal.aborted) return undefined; // superseded or unmounted
        throw e;
      }
    },
    [],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { run, stop };
}
