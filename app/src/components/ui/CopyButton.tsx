"use client";
import { useState } from "react";
import { CopyIcon } from "./icons";

/** Copies a value to the clipboard (an address, a pool id, calldata). Nothing else. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={done ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      style={{ border: 0, background: "transparent", color: done ? "var(--positive)" : "var(--ink-secondary)", cursor: "pointer", padding: 2, display: "inline-flex" }}
    >
      <CopyIcon />
    </button>
  );
}
