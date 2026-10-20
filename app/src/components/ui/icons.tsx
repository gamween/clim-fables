// clim's own 16 px icons (two-tone like Fables' nav icons: --icon-1 faint, --icon-2 muted). Drawn for this app; no
// Fables icon is copied.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 16, ...p }: P) => ({ width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, ...p });

export const InfoIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.2" />
    <path d="M8 7.2v3.8M8 5.2v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
export const ArrowRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ArrowLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 8H3.5M7 4.5 3.5 8 7 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ExternalIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5.5 4.5h6v6M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ChevronRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6.5 4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M10.5 3.5h-6a1 1 0 0 0-1 1v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
export const MenuIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
/** GitHub's mark (Primer Octicons `mark-github`, MIT), for the links to the repository. */
export const GitHubIcon = (p: P) => (
  <svg {...base(p)}>
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
    />
  </svg>
);
export const MarketsIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="3" height="8" rx="1" fill="var(--icon-1, #636161)" />
    <rect x="6.5" y="2" width="3" height="12" rx="1" fill="var(--icon-2, #8f8e8e)" />
    <rect x="11" y="8" width="3" height="6" rx="1" fill="var(--icon-1, #636161)" />
  </svg>
);
export const IntegrateIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="1.5" y="3" width="6" height="10" rx="2" fill="var(--icon-1, #636161)" />
    <rect x="8.5" y="3" width="6" height="10" rx="2" fill="var(--icon-2, #8f8e8e)" />
  </svg>
);
export const EvidenceIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2.5" y="1.5" width="11" height="13" rx="2" fill="var(--icon-1, #636161)" />
    <path d="m5.5 8.5 1.8 1.8L11 6.5" stroke="var(--icon-2, #8f8e8e)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const RunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.5" fill="var(--icon-1, #636161)" />
    <path d="M6.5 5.5v5l4-2.5-4-2.5Z" fill="var(--icon-2, #8f8e8e)" />
  </svg>
);
/** ETH: white on Ethereum blue, as Fables draws it; grey for clim's test token (tETH); `bare` drops the disc (badges). */
export const EthMark = ({ size = 16, test = false, bare = false }: { size?: number; test?: boolean; bare?: boolean }) => (
  <svg width={size} height={size} viewBox={bare ? "8 4 16 24" : "0 0 32 32"} aria-hidden>
    {bare ? null : <circle cx="16" cy="16" r="16" fill={test ? "#2a2828" : "#627eea"} />}
    <path d="M16 5.5 9.5 16.3 16 20.1l6.5-3.8L16 5.5Z" fill={test ? "#bcbbbb" : "#ffffff"} />
    <path d="M16 21.4 9.5 17.6 16 26.5l6.5-8.9-6.5 3.8Z" fill={test ? "#8f8e8e" : "#ffffff"} fillOpacity={test ? 1 : 0.8} />
  </svg>
);

export const PulseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M1.5 8.5h3l1.5-4 3 8 1.8-5.5 1 1.5h2.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Docs sidebar leaves (two-tone, 16 px).
const F1 = "var(--icon-1, #636161)";
const F2 = "var(--icon-2, #8f8e8e)";
export const LadderIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="10" width="4" height="4" rx="1" fill={F1} />
    <rect x="6" y="6" width="4" height="8" rx="1" fill={F2} />
    <rect x="10" y="2" width="4" height="12" rx="1" fill={F1} />
  </svg>
);
export const KeyIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="8" r="3.5" fill={F2} />
    <rect x="8" y="7" width="6.5" height="2" rx="1" fill={F1} />
    <rect x="11.5" y="8" width="2" height="3.5" rx="1" fill={F1} />
  </svg>
);
export const BatchIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="12" height="4" rx="1.5" fill={F2} />
    <rect x="2" y="7" width="12" height="3" rx="1.5" fill={F1} />
    <rect x="2" y="11" width="12" height="3" rx="1.5" fill={F1} />
  </svg>
);
export const ShieldIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 1.5 13.5 3.5v4.2c0 3.2-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.6-5.5-6.8V3.5L8 1.5Z" fill={F1} />
    <path d="m5.6 8 1.7 1.7L10.6 6.4" stroke={F2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const PathIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="4" cy="12" r="2.5" fill={F1} />
    <circle cx="12" cy="4" r="2.5" fill={F2} />
    <path d="M4 9.5V7a2 2 0 0 1 2-2h3.5" stroke={F1} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
export const ChartIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="12" height="12" rx="2" fill={F1} />
    <path d="M4.5 11 7 7.5l2 2L11.5 5" stroke={F2} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const ForkIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="4.5" cy="3.5" r="2" fill={F2} />
    <circle cx="11.5" cy="3.5" r="2" fill={F1} />
    <circle cx="8" cy="12.5" r="2" fill={F2} />
    <path d="M4.5 5.5c0 2.5 3.5 2.5 3.5 5M11.5 5.5c0 2.5-3.5 2.5-3.5 5" stroke={F1} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
export const GaugeIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 11a6 6 0 0 1 12 0" stroke={F1} strokeWidth="2.5" strokeLinecap="round" />
    <path d="M8 11 10.5 6.5" stroke={F2} strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
export const LoopIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" stroke={F1} strokeWidth="2" strokeLinecap="round" />
    <path d="M12.5 1.8v3.2H9.3" stroke={F2} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6.5" fill={F1} />
    <rect x="5.5" y="5" width="1.8" height="6" rx=".9" fill={F2} />
    <rect x="8.7" y="5" width="1.8" height="6" rx=".9" fill={F2} />
  </svg>
);
export const WarningIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 1.8 14.5 13.5h-13L8 1.8Z" fill={F1} />
    <path d="M8 6.3v3.2M8 11.4v.1" stroke={F2} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
