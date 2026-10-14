"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { promoDismissed, PROMO_DISMISS_KEY } from "@/lib/promo";
import s from "./shell.module.css";

const SLIDES = [
  { title: "clim is watching ETH/USDG", body: "Fables' live fee next to clim's, read from the chain.", href: "/markets/eth" },
  { title: "Level 2 is one batch", body: "One AccessManager batch, revocable in one call.", href: "/integrate" },
  { title: "Replay the 7 October storm", body: "clim's pokes on Fables' real hook, on a fork.", href: "/run" },
] as const;
const SLIDE_MS = 7_000;

/** Routes laid out like Fables' docs, where Fables shows no promo card. */
const NO_PROMO = ["/integrate", "/evidence", "/credits"];

const noSubscribe = () => () => {};

function storedDismissal(): "dismissed" | "shown" {
  try {
    return promoDismissed(window.localStorage.getItem(PROMO_DISMISS_KEY), Date.now()) ? "dismissed" : "shown";
  } catch {
    return "shown";
  }
}

function useSlides() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => setI((v) => (v + 1) % SLIDES.length), SLIDE_MS);
    return () => clearTimeout(id);
  }, [i, paused]);
  return { i, slide: SLIDES[i] ?? SLIDES[0], setPaused };
}

function Slide({ slide }: { slide: (typeof SLIDES)[number] }) {
  return (
    <Link key={slide.href} href={slide.href} className={s.toastSlide}>
      <span className={s.toastTitle}>{slide.title}</span>
      <span className={s.toastBody}>{slide.body}</span>
    </Link>
  );
}

/** Fables' rotating promo card (bottom left), carrying clim's three entry points. As on Fables, it fades in, pauses on
 *  hover, and its dismiss cross hides it for 24 hours. It floats only where it clears the content column (a viewport of
 *  at least 1712 px: a 1200 px column plus two 256 px gutters); narrower, it lives in the header menu
 *  (PromoMenuCard), as Fables' card does on phones. */
export function PromoToast() {
  const pathname = usePathname();
  const { i, slide, setPaused } = useSlides();
  // "server" until hydrated, so the card fades in after the page as on Fables.
  const stored = useSyncExternalStore(noSubscribe, storedDismissal, () => "server");
  const [hidden, setHidden] = useState(false);
  if (hidden || stored === "dismissed" || stored === "server" || NO_PROMO.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(PROMO_DISMISS_KEY, String(Date.now()));
    } catch {
      // Private window or blocked storage: hide it for this visit only.
    }
    setHidden(true);
  };
  return (
    <aside className={s.toast} aria-label="clim" data-promo onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <span className={s.toastBadge} aria-hidden>
        c
      </span>
      <svg className={s.toastRing} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="5" fill="none" stroke="var(--raised)" strokeWidth="1.5" />
        <circle key={i} cx="6" cy="6" r="5" fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeDasharray="31.4" strokeDashoffset="31.4" transform="rotate(-90 6 6)">
          <animate attributeName="stroke-dashoffset" from="31.4" to="0" dur={`${SLIDE_MS / 1000}s`} fill="freeze" />
        </circle>
      </svg>
      <button type="button" className={s.toastClose} aria-label="Dismiss for 24 hours" onClick={dismiss}>
        ×
      </button>
      <Slide slide={slide} />
    </aside>
  );
}

/** The same card, embedded in the header menu (Fables' "promotion" slot) where the floating one would cover content. */
export function PromoMenuCard({ onNavigate }: { onNavigate: () => void }) {
  const { slide } = useSlides();
  return (
    <div className={s.menuPromo} onClick={onNavigate} data-promo>
      <span className={s.toastBadge} aria-hidden>
        c
      </span>
      <Slide slide={slide} />
    </div>
  );
}
