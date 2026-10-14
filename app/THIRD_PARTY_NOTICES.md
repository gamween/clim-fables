# Credits and licences

clim × Fables is a showcase by clim. It is not affiliated with Fables. clim's own code is under the MIT licence
(`LICENSE` at the repository root). This page lists what the showcase uses that is not clim's. The licence text of
every npm package in the app's dependencies is in [/third-party-licenses.txt](/third-party-licenses.txt)
(`npm run licenses` regenerates it).

## Fables' look, name and assets

The showcase reproduces the interface of [Fables](https://www.fables.fi) on purpose, to show where clim would sit in
Fables' own product. It does so as a showcase, on its own domain, under a permanent "Showcase by clim, not affiliated
with Fables" banner, with no wallet connection and no transaction.

- **The interface.** Layout, colours, type scale, spacing, radii, shadows and motion were measured on
  `www.fables.fi` on 2026-10-14 and rebuilt from those measurements
  ([docs/research/fables-ui-inventory.md](https://github.com/gamween/clim-fables/blob/main/docs/research/fables-ui-inventory.md)).
  No Fables stylesheet, script or component source is copied; Fables' contract sources (SPDX UNLICENSED) are not in
  this repository, and the app reads Fables' contracts through their published interface only.
- **Name, logo and art.** The Fables name, the fox-and-star logo and mark, the landing landscape, the unicorn
  illustration and the USDG token mark come from Fables' public brand kit at
  [fables.fi/brand](https://www.fables.fi/brand) (downloaded 2026-10-13); the favicon (`favicon.ico`) and
  `apple-touch-icon.png` are the files fables.fi serves. They belong to Fables. They are served by the
  deployed showcase only, from `public/fables/`, which is not committed to the repository
  (`npm run fables-assets` copies them from the maintainer's local copy of the kit).
- **Louize.** The display face is Louize Display Medium by 205TF, a commercial typeface, in the subset Fables serves
  on its site. It belongs to 205TF; its use in this showcase is the maintainer's decision. The font file is not
  committed to the repository.
- **Inter.** The text face is Inter, in the build Fables serves. Inter is by Rasmus Andersson and The Inter Project
  Authors, under the SIL Open Font License 1.1 (https://openfontlicense.org). Not committed either, to keep every
  file taken from Fables' kit in one place.
- **Copy.** A few interface strings follow Fables' own wording (for example the "Dynamic Fee" section description and
  the "Current fee" tooltips) so the pages read like Fables' product; every one sits next to clim's own labels.

## Code

- [viem](https://viem.sh) (MIT, © weth, LLC), the only chain library in the app: public clients and ABI encoding.
  No wallet library is a dependency.
- [Next.js](https://nextjs.org) and [React](https://react.dev) (MIT).
- [react-markdown](https://github.com/remarkjs/react-markdown) and [remark-gfm](https://github.com/remarkjs/remark-gfm)
  (MIT, © Espen Hovlandsdal and Titus Wormer), for this page.

## Data

Live numbers are read from Robinhood Chain mainnet (Fables' ETH/USDG pool, read only) and testnet (clim's desk and
pools D, K, F) through their public RPC endpoints. Evidence and lab numbers are quoted from files committed to the
repository, each named where it is shown.

## The TOKEN2049 version

The dashboard clim showed at TOKEN2049 Origins (Ethereum Sepolia, with a wallet and test transactions) and its own
notices are kept at the tag `token2049-submission`:
[DVB-ANS/clim @ token2049-submission](https://github.com/DVB-ANS/clim/tree/token2049-submission).
