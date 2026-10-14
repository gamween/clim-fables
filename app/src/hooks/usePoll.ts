"use client";
import { useEffect, useRef, useState } from "react";

export type Polled<T> = { data: T | null; error: unknown; updatedAt: number | null };

/** Calls `fn` now and every `intervalMs` while the tab is visible; keeps the last good value when a call fails.
 *  `fn` may `publish` an early value (a cached copy) before it resolves. A new `key` starts over. */
export function usePoll<T>(fn: (publish: (data: T) => void) => Promise<T>, intervalMs: number, key = ""): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: null, error: null, updatedAt: null });
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (data: T) => {
      if (alive) setState({ data, error: null, updatedAt: Date.now() });
    };
    const tick = async () => {
      if (document.visibilityState !== "hidden") {
        try {
          publish(await fnRef.current(publish));
        } catch (error) {
          if (alive) setState((s) => ({ ...s, error }));
        }
      }
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [intervalMs, key]);
  return state;
}
