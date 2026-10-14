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
export const EthMark = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <circle cx="16" cy="16" r="16" fill="#2a2828" />
    <path d="M16 5.5 9.5 16.3 16 20.1l6.5-3.8L16 5.5Z" fill="#bcbbbb" />
    <path d="M16 21.4 9.5 17.6 16 26.5l6.5-8.9-6.5 3.8Z" fill="#8f8e8e" />
  </svg>
);
