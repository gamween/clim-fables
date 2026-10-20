"use client";
// The entry notice, in Fables' dialog style (a native <dialog>: 16 px radius, surface background, hairline border, dimmed
// backdrop, Fables' entrance motion). It opens on a visitor's first page and stays closed for 30 days once acknowledged
// (lib/notice.ts). Escape counts as an acknowledgement; a click on the backdrop does not close it.
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExternalIcon, GitHubIcon, KeyIcon, LadderIcon, ShieldIcon, WarningIcon } from "@/components/ui/icons";
import { NOTICE_KEY, NOTICE_POINTS, noticeAcknowledged } from "@/lib/notice";
import { FABLES_APP_URL, REPO_URL } from "@/lib/site";
import s from "./notice.module.css";

const ICONS = { affiliation: ShieldIcon, advice: WarningIcon, testnet: LadderIcon, wallet: KeyIcon, experimental: WarningIcon } as const;

function stored(): string | null {
  try {
    return window.localStorage.getItem(NOTICE_KEY);
  } catch {
    return null;
  }
}

const noSubscribe = () => () => {};
const due = () => !noticeAcknowledged(stored(), Date.now());

export function NoticeDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  // False on the server and until hydrated: the notice opens after the page, never in the static HTML.
  const isDue = useSyncExternalStore(noSubscribe, due, () => false);
  const [done, setDone] = useState(false);
  const open = isDue && !done;

  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) {
      d.showModal();
      accept.current?.focus();
    }
  }, [open]);

  const acknowledge = () => {
    try {
      window.localStorage.setItem(NOTICE_KEY, String(Date.now()));
    } catch {
      // Private mode or blocked storage: the notice shows again on the next visit.
    }
    ref.current?.close();
    setDone(true);
  };

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="notice-title"
      aria-describedby="notice-intro"
      data-qa="notice"
      onCancel={(e) => {
        e.preventDefault();
        acknowledge();
      }}
    >
      {open ? (
        <>
          <div className={s.head}>
            <span className={s.mark} aria-hidden />
            <div>
              <h2 id="notice-title" className={s.title}>
                Before you look around
              </h2>
              <p id="notice-intro" className={s.intro}>
                clim × Fables is a showcase. Please read this first.
              </p>
            </div>
          </div>
          <ul className={s.list}>
            {NOTICE_POINTS.map((p) => {
              const Icon = ICONS[p.icon];
              return (
                <li key={p.title} className={s.item}>
                  <span className={s.chip} aria-hidden>
                    <Icon size={16} />
                  </span>
                  <span>
                    <span className={s.itemTitle}>{p.title}</span>
                    <span className={s.itemBody}>{p.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className={s.callout} role="note">
            <WarningIcon size={16} />
            <span>
              Looking for Fables itself? Its app is at{" "}
              <a href={FABLES_APP_URL} target="_blank" rel="noreferrer">
                fables.fi <ExternalIcon size={12} />
              </a>
            </span>
          </div>
          <div className={s.foot}>
            <button ref={accept} type="button" className={s.accept} onClick={acknowledge} data-qa="notice-accept">
              I understand
            </button>
            <div className={s.links}>
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                <GitHubIcon size={14} /> Source on GitHub
              </a>
              <Link href="/credits" onClick={acknowledge}>
                Credits and licences
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
