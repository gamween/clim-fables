import { BANNER_DETAIL, BANNER_TEXT } from "@/lib/site";
import s from "./shell.module.css";

/** Fables' announcement bar, made permanent: no dismiss button, never hidden on scroll. */
export function Banner() {
  return (
    <div className={s.banner} role="note" data-guard="banner" data-qa="banner">
      <span className={s.bannerMark} aria-hidden />
      <strong style={{ fontWeight: 500 }}>{BANNER_TEXT}</strong>
      <span className={s.bannerMuted}>
        <span className={s.bannerDot}>· </span>
        {BANNER_DETAIL}
      </span>
    </div>
  );
}
