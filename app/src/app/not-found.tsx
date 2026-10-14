import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "64px 0" }}>
      <span aria-hidden style={{ width: 200, height: 131, background: "var(--ink)", mask: "url(/fables/fox_star_logo.svg) center / contain no-repeat" }} />
      <p style={{ fontSize: 16, lineHeight: "24px", fontWeight: 450, color: "var(--ink-secondary)" }}>Sorry, we couldn&apos;t find that page.</p>
      <Link href="/" style={{ color: "var(--ink-muted)" }}>
        Back to Home
      </Link>
    </div>
  );
}
