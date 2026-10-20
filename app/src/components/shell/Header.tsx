"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { EvidenceIcon, ExternalIcon, GitHubIcon, IntegrateIcon, MarketsIcon, MenuIcon, RunIcon } from "@/components/ui/icons";
import uiStyles from "@/components/ui/ui.module.css";
import { FABLES_APP_URL, NAV, NO_WALLET_TEXT, REPO_URL, repoFile } from "@/lib/site";
import { PromoMenuCard } from "./PromoToast";
import s from "./shell.module.css";

const ICONS = { markets: MarketsIcon, integrate: IntegrateIcon, evidence: EvidenceIcon, run: RunIcon } as const;

export function activeHref(pathname: string): string | null {
  const hit = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  return hit ? hit.href : null;
}

/** The brand: Fables' mark next to "clim × Fables", never Fables' logo alone. */
export function Brand() {
  return (
    <Link href="/" className={s.brand} aria-label="clim × Fables, home" data-guard="identity">
      <span className={s.brandLogo} aria-hidden />
      <span className={s.brandText} data-qa="brand-text">
        clim<span className={s.brandTimes}>×</span>Fables
      </span>
    </Link>
  );
}

/** Where Fables shows the account chip or "Connect". Inert: the showcase never connects a wallet. */
export function NoWalletPill() {
  return (
    <span className={s.noWallet} data-guard="no-wallet" aria-disabled="true" title="This showcase has no wallet and sends no transaction">
      <span className={s.noWalletDot} aria-hidden />
      {NO_WALLET_TEXT}
    </span>
  );
}

/** The slot of Fables' rewards chest (a 36 px icon button left of the menu): the repository, on every route. */
export function RepoButton() {
  return (
    <a className={`${uiStyles.iconButton} ${s.repoButton}`} href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source code on GitHub" title="Source code on GitHub" data-qa="repo-link">
      <GitHubIcon size={18} />
    </a>
  );
}

function NavPill({ pathname }: { pathname: string }) {
  const active = activeHref(pathname);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = active ? refs.current[active] : null;
    setBox(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [active]);
  const style = box ? ({ "--nav-left": `${box.left}px`, "--nav-width": `${box.width}px` } as CSSProperties) : undefined;
  return (
    <nav className={s.nav} aria-label="Main" style={style} data-qa="nav">
      {box ? <span className={s.navIndicator} aria-hidden /> : null}
      {NAV.map((n) => {
        const Icon = ICONS[n.icon];
        return (
          <Link
            key={n.href}
            href={n.href}
            className={s.navLink}
            aria-current={active === n.href ? "page" : undefined}
            ref={(el) => {
              refs.current[n.href] = el;
            }}
          >
            <Icon />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Menu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const items = [
    ...NAV.map((n) => ({ href: n.href, label: n.label, external: false })),
    { href: "/credits", label: "Credits and licences", external: false },
    { href: REPO_URL, label: "Source on GitHub", external: true },
    { href: repoFile("docs/security.md"), label: "Security", external: true },
    { href: FABLES_APP_URL, label: "Fables' own app", external: true },
  ];
  return (
    <div className={s.menuWrap} ref={wrap}>
      <button type="button" className={uiStyles.iconButton} aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MenuIcon />
      </button>
      {open ? (
        <div className={s.menu} role="menu">
          {items.map((i, k) => (
            <div key={i.href}>
              {k === NAV.length ? <div className={s.menuSep} /> : null}
              {i.external ? (
                <a className={s.menuItem} role="menuitem" href={i.href} target="_blank" rel="noreferrer">
                  {i.label}
                  <ExternalIcon size={14} />
                </a>
              ) : (
                <Link className={s.menuItem} role="menuitem" href={i.href} onClick={() => setOpen(false)}>
                  {i.label}
                </Link>
              )}
            </div>
          ))}
          <PromoMenuCard onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`${s.header} ${scrolled ? s.headerScrolled : ""}`} data-qa="header">
      <div className={s.headerInner}>
        <Brand />
        <NavPill pathname={pathname} />
        <div className={s.right}>
          <NoWalletPill />
          <RepoButton />
          <Menu />
        </div>
      </div>
    </header>
  );
}
