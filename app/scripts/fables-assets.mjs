// Fables' brand files the showcase uses (logo mark, fox-and-star logo, landing art, the USDG token mark, favicon and
// apple-touch-icon, Louize and Inter). They belong to Fables and are not committed: public/fables/ is gitignored. This script copies them from the
// brand kit downloaded to .local/ (fables.fi/brand, 2026-10-13) before a local run or a deploy from the maintainer's
// machine; `--check` only verifies they are in place (run before `vercel deploy`).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const KIT = ".local/research-2026-10-13/fables-brand";

/** [source in the kit, destination under public/fables/] */
export const FABLES_ASSETS = [
  ["assets/logo.svg", "logo.svg"],
  ["assets/fox_star_logo.svg", "fox_star_logo.svg"],
  ["assets/hero-bg.webp", "hero-bg.webp"],
  ["assets/illustrations_landing_unicorn-ledge.webp", "unicorn-ledge.webp"],
  ["assets/tokens_USDG.svg", "tokens_USDG.svg"],
  // Fables' favicon (16, 32 and 48 px in one .ico) and its 180 px apple-touch-icon, served as fables.fi serves them.
  ["assets/favicon.ico", "favicon.ico"],
  ["assets/apple-touch-icon.png", "apple-touch-icon.png"],
  ["fonts/louize-display-medium.woff2", "fonts/louize-display-medium.woff2"],
  ["fonts/inter.woff2", "fonts/inter.woff2"],
];

export function missingAssets(appRoot) {
  return FABLES_ASSETS.map(([, dest]) => dest).filter((d) => !existsSync(join(appRoot, "public/fables", d)));
}

export function copyAssets({ repoRoot, appRoot }) {
  const kit = join(repoRoot, KIT);
  const absent = FABLES_ASSETS.filter(([src]) => !existsSync(join(kit, src))).map(([src]) => src);
  if (absent.length > 0) throw new Error(`missing in ${KIT}: ${absent.join(", ")}`);
  for (const [src, dest] of FABLES_ASSETS) {
    const to = join(appRoot, "public/fables", dest);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(kit, src), to);
  }
  return FABLES_ASSETS.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = process.env.CLIM_ROOT ? resolve(process.env.CLIM_ROOT) : dirname(appRoot);
  if (process.argv.includes("--check")) {
    const missing = missingAssets(appRoot);
    if (missing.length > 0) {
      console.error(`public/fables is missing ${missing.join(", ")}: run npm run fables-assets`);
      process.exit(1);
    }
    console.log(`public/fables: ${FABLES_ASSETS.length} files in place`);
  } else {
    console.log(`copied ${copyAssets({ repoRoot, appRoot })} files to public/fables`);
  }
}
