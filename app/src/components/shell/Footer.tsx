import Link from "next/link";
import { FABLES_APP_URL, REPO_URL, repoFile } from "@/lib/site";
import s from "./shell.module.css";

const COLUMNS = [
  { title: "Showcase", links: [["Markets", "/markets"], ["Integrate", "/integrate"], ["Evidence", "/evidence"], ["Run", "/run"]] },
  { title: "Sources", links: [["Repository", REPO_URL], ["Integration guide", repoFile("docs/integrate/README.md")], ["Security", repoFile("docs/security.md")], ["Evidence files", `${REPO_URL}/tree/main/docs/evidence`]] },
  { title: "About", links: [["Credits and licences", "/credits"], ["Fables' own app", FABLES_APP_URL], ["TOKEN2049 submission", "https://github.com/DVB-ANS/clim/tree/token2049-submission"]] },
] as const;

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={s.footerTop}>
        <div>
          <span className={s.brand}>
            <span className={s.brandLogo} aria-hidden />
            <span className={s.brandText}>
              clim<span className={s.brandTimes}>×</span>Fables
            </span>
          </span>
          <p className={s.footerBlurb}>
            A showcase by clim: a verifiable volatility desk for Fables&apos; dynamic fees on Robinhood Chain. Not affiliated with Fables. Fables&apos; name, logo, art and fonts
            belong to Fables.
          </p>
        </div>
        <div className={s.footerCols}>
          {COLUMNS.map((c) => (
            <div key={c.title} className={s.footerCol}>
              <span className={s.footerTitle}>{c.title}</span>
              {c.links.map(([label, href]) =>
                href.startsWith("http") ? (
                  <a key={label} className={s.footerLink} href={href} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                ) : (
                  <Link key={label} className={s.footerLink} href={href}>
                    {label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={s.footerBottom}>
        <span>MIT for clim&apos;s code</span>
        <span>Live data read from Robinhood Chain mainnet (Fables) and testnet (clim)</span>
      </div>
    </footer>
  );
}
