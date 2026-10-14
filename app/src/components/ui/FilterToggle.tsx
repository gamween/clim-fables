"use client";
// Fables' segmented switcher: a radiogroup with a highlight that slides to the active item.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import s from "./ui.module.css";

export function FilterToggle<T extends string>({ options, value, onChange, label }: { options: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el) setBox({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);
  const style = box ? ({ "--highlight-left": `${box.left}px`, "--highlight-width": `${box.width}px` } as CSSProperties) : undefined;
  return (
    <div className={s.toggle} role="radiogroup" aria-label={label} style={style}>
      <span className={s.toggleHighlight} aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[o.value] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={s.toggleItem}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodButtons<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={s.periods}>
      {options.map((o) => (
        <button key={o} type="button" className={s.period} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
