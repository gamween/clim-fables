"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import s from "./shell.module.css";

const SLIDES = [
  { title: "clim is watching ETH/USDG", body: "Fables' live fee next to clim's, read from the chain.", href: "/markets/eth" },
  { title: "Level 2 is one batch", body: "One AccessManager batch, revocable in one call.", href: "/integrate" },
  { title: "Replay the 7 October storm", body: "clim's pokes on Fables' real hook, on a fork.", href: "/run" },
] as const;
const SLIDE_MS = 7_000;

/** Fables' rotating promo card (bottom left), carrying clim's three entry points. */
export function PromoToast() {
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(id);
  }, []);
  if (hidden) return null;
  const slide = SLIDES[i] ?? SLIDES[0];
  return (
    <aside className={s.toast} aria-label="clim">
      <span className={s.toastBadge} aria-hidden>
        c
      </span>
      <svg className={s.toastRing} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="5" fill="none" stroke="var(--raised)" strokeWidth="1.5" />
        <circle key={i} cx="6" cy="6" r="5" fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeDasharray="31.4" strokeDashoffset="31.4" transform="rotate(-90 6 6)">
          <animate attributeName="stroke-dashoffset" from="31.4" to="0" dur={`${SLIDE_MS / 1000}s`} fill="freeze" />
        </circle>
      </svg>
      <button type="button" className={s.toastClose} aria-label="Hide" onClick={() => setHidden(true)}>
        ×
      </button>
      <Link key={slide.href} href={slide.href} className={s.toastSlide}>
        <span className={s.toastTitle}>{slide.title}</span>
        <span className={s.toastBody}>{slide.body}</span>
      </Link>
    </aside>
  );
}
