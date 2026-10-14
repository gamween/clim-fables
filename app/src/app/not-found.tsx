import Link from "next/link";
import { ArrowLeftIcon } from "@/components/ui/icons";
import s from "@/components/notFound.module.css";

/** Fables' 404 (inventory §2.5): the fox-and-star mask, three bobbing question marks, the line and "Back to Home" with
 *  its arrow; no footer and no promo card on this page, as on Fables. */
export default function NotFound() {
  return (
    <div className={s.page} data-page="not-found">
      <div className={s.inner}>
        <div className={s.art} aria-hidden>
          <span className={s.logo} />
          <span className={s.mark} style={{ left: -2, top: -16, ["--bob" as string]: "0s", ["--tilt" as string]: "-0.4s" }}>
            ?
          </span>
          <span className={s.mark} style={{ left: 30, top: -8, ["--bob" as string]: "-0.5s", ["--tilt" as string]: "-1.1s" }}>
            ?
          </span>
          <span className={s.mark} style={{ left: 62, top: -16, ["--bob" as string]: "-1s", ["--tilt" as string]: "-0.7s" }}>
            ?
          </span>
        </div>
        <p className={s.description}>Sorry, we couldn&apos;t find that page.</p>
        <p className={s.backSlot}>
          <Link href="/">
            <ArrowLeftIcon size={16} />
            Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
