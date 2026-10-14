# Fables UI inventory

Research for the clim × Fables showcase app (`app/`, spec §5.5). Goal: a later team can rebuild Fables' surfaces one to one
in Next.js and graft clim where it would live in their product, without changing their layout.

- Captured: 2026-10-14, live on `https://www.fables.fi`, in the maintainer's own Chrome (one new tab, closed at the end).
- Build observed: main stylesheet `index-Bap1DDM4.css`, identical byte for byte to the 2026-10-13 snapshot in
  `.local/research-2026-10-13/fables-brand/src/index.css`.
- Reference viewport: 1450 × 838 CSS px (window 1470 px wide, the maintainer's MacBook), DPR 2.
- Local evidence (gitignored, never published): `.local/fables-ui/`
  - `measurements.json`: the computed styles quoted below, in compact form;
  - `css/` and `css-readable/`: the live stylesheets of the visited routes (readable copies have class hashes stripped to
    `name~hash`), kept for lookup only;
  - `02` to `11` `*.jpg|png`: screenshots, wallet chip hidden, personal data blurred.

Rules for the rebuild:
- Rebuild from the values in this file. Do not copy Fables' CSS or JS files into the repo (same rule as the
  contracts: their code is UNLICENSED).
- Every page keeps the showcase guardrails of spec §5.5 (own domain, permanent non-affiliation banner,
  "clim × Fables" in the nav, no wallet connection, no real transaction).

## 0. Method and limits

What was measured live (via `getComputedStyle`, `getBoundingClientRect`, DOM walks):
- every page listed in §2 at 1450 px: layout boxes, fonts, colours, radii, shadows, paddings, gaps;
- open states: header menu, market filter dropdowns, pool "more" menu, chart tabs (Price, Volume, Liquidity, Depth),
  chart hover tooltip, row hover, docs demo tabs.

What came from the stylesheets instead of a live measurement:
- hover, focus and active states (CSS rules, cross-checked against two live hovers);
- all mobile and tablet behaviour (see "Mobile" below);
- keyframes and transition timings.

Not measured:
- **Mobile at 390 px, live.** `resize_window` reported success but the window stayed at 1457 × 841 (the maintainer's
  window does not resize from the extension). A same-origin iframe at 390 px was then refused by the site's framing policy.
  Every mobile spec below is therefore read from the `@media` rules, not observed. Verify on a phone before shipping.
- **Swap UI.** There is no swap page: `/swap` is a 404 and no route in the bundle swaps. Swap only exists inside the deposit
  "Zap" flow, which needs a connected wallet and amounts (not entered, per the rules).
- Deposit steps 2 and 3 (amounts, review and sign): not opened, they would show the maintainer's balances and lead to a
  signature.
- The rewards (chest) menu in the header and the markets settings menu (square button): not opened.
- Skeleton states were seen once on `/markets` before data landed (screenshot not kept); their styles come from CSS.

Privacy precautions taken:
- the maintainer's wallet was already connected. The account chip was hidden with injected CSS before any saved
  screenshot; extracted text was passed through an address mask and, on Portfolio and Leaderboard, a digit mask;
- no address, balance, position, rank, points total or referral code of his is written here or in `.local/fables-ui/`;
  the Portfolio screenshot has every value, chart and pair blurred or hidden; no Leaderboard screenshot was kept;
- nothing was clicked that connects, signs, approves or sends. No form was typed into.

## 1. Global shell (every app page)

### 1.1 Layout frame

- `body`: background `#100f0f` (canvas), Inter 14/20, weight 400, tracking -0.22 px, `-webkit-font-smoothing: antialiased`,
  `font-feature-settings: "calt" off`.
- Shell: column flex, `min-height: 100dvh`; `main` grows. Shell variables: `--top-banner-height` (40 px when the banner shows,
  56 px under 576 px), `--header-offset` (same value; 0 once the banner is scrolled away).
- Content column: `max-width: 1200px`, centred, side padding 80 px (32 px under 992 px, 10 to 16 px under 576 px). At
  1450 px the column runs x = 125 to 1325.
- Page top padding: `nav-h (80) + 48 + banner (40)` = 168 px on the landing, portfolio and brand pages; markets uses
  `nav-h + banner + 32` = 152 px; the pool page `nav-h + banner + 24` = 144 px.
- Vignette: a fixed `::before` on the page, 70 vw wide, `box-shadow: 0 0 200px 160px var(--canvas)`, z-index -1. It darkens
  the page edges behind content.
- `html, body { overflow-x: clip }`.

### 1.2 Announcement banner (top, fixed)

- Position fixed, top 0, full width, height 40, z-index 9000, flex centred, gap 8, padding 0 40.
- Current variant "selection" (Points claim):
  - background `#1e1e1b` plus two radial lime glows `rgb(171 199 65 / .2)`, radius 280 px, one at (168 px, bottom + 26 px),
    one at (right - 196 px, -26 px);
  - a dot grid masked to the same two glows;
  - six token coins scattered absolutely (24 to 40 px, `translate: -50% -50%`), hidden progressively under 1280, 1024,
    720 px;
  - a 20 px Fables mark, then text Inter 12/16 500 -0.13 px white:
    "FABLES launches 20 October. Choose how to claim your Points by 19 October.";
  - dismiss button 32 × 32 (44 × 44 on mobile) at right 8, a 12 × 2 px cross drawn with two rotated bars, colour
    `#8f8e8e`, white on hover.
- Other variants in CSS: `points` (lime background, `#201d1d` text), `geo` (negative tone 14 % over canvas), `gas`
  (session amber 16 % over canvas).
- Bottom hairline: `inset 0 -1px rgba(255,255,255,.06)`.
- Hide on scroll: `transform: translateY(-100%)` and `visibility: hidden`, 0.2 s ease-in-out; the header slides up by
  the same 40 px.
- Under 576 px: height 56, left-aligned, padding 0 44 0 16.

### 1.3 Header

- Fixed, top 0, full width, height 80 (`--nav-h`; 60 under 576 px), padding 0 80, background canvas, z-index 9000.
- `transform: translateY(var(--header-offset))`, transition 0.2 s ease-in-out on transform and box-shadow.
- Scrolled state: `box-shadow: 0 1px 0 rgba(255,255,255,.06)` (seen live once the page scrolls).
- Inner: 1200 wide, padding 22 px 0, `space-between`.
- **Brand** (left): logo mask `/logo.svg` (aspect 500/328, 32 px tall; 28 px under 1100 px) in white, gap 8, then
  "Fables" in Louize 32/32 500 (28/28 under 1100 px), trimmed to cap height. On hover the logo turns lime (footer variant).
- **Nav pill** (absolutely centred):
  - 408 × 46, background `#1f1e1e`, 1 px border `rgba(255,255,255,.06)`, radius 12, padding 6, gap 2,
    shadow `0 2px 8px rgba(0,0,0,.4)`;
  - links: height 32, padding 0 10, radius 5 (`12 - 6 - 1`), gap 4, Inter 14/20 500 -0.22 px, colour `#bcbbbb`;
    a 16 px two-tone icon before each label (icon colours `--icon-1` faint, `--icon-2` muted; active: muted and secondary);
  - items: Markets (`/markets`), Portfolio (`/portfolio`), Leaderboard (`/portfolio/points`), Vote (button, gated, no page);
  - active item: white text plus a sliding indicator chip behind it (absolute, top and bottom 6 px, radius 5, `#2a2828`);
  - hover (pointer devices, ≥ 576 px): background `#2a2828`, white text; transition 0.15 s on background, colour, scale;
  - hidden under 1100 px (the hamburger menu carries the same items).
- **Right cluster** (gap 4):
  - account chip (wallet connected): 135 × 36, background `#1f1e1e`, radius 12, padding 8 12 8 8, gap 8, 20 px gradient
    avatar, address text Inter 14/20 500, shadow `0 2px 6px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.06)`;
    hover `rgba(255,255,255,.06)`. Disconnected state is a white "Connect" button (background `#fff`, text `#1f1e1e`).
    **The showcase never renders either**: put the "clim × Fables" mark and the non-affiliation note here instead;
  - rewards trigger: 36 × 36, radius 12, a chest icon (`icons_chest-closed.png` and `-open.png` in the brand kit);
  - menu trigger: 36 × 36, radius 12, three 11 px lines; turns into a cross when open.
- **Header menu** (open state, measured): 234 wide, background `#1f1e1e`, radius 12, padding 4, gap 2,
  shadow `0 0 0 1px rgba(255,255,255,.1), 0 6px 32px rgba(0,0,0,.35)`, top = trigger + 12 px, right-aligned.
  Items: padding 8 12, radius 12, gap 10, Inter 14/20 400 white, hover `rgba(255,255,255,.06)`. Desktop items: Docs,
  Telegram, Discord, Twitter / X, each with a leading 16 px icon (the nav items are prepended under 1100 px).
  Separator: 1 px `rgba(255,255,255,.06)`, margin 4 0.

### 1.4 Promo toast (bottom left, rotating)

- Fixed, left 20, bottom 16, 220 wide, aspect 13.75 / 9.1875 (about 147 px tall), background `#1a1919`, radius 12,
  1 px inner ring `rgba(255,255,255,.06)`, dot grid masked from the top left.
- Slides rotate every 7 s; a 12 px circular progress ring (stroke 1.5) fills in 7 s, top right. On hover the ring fades
  out and a dismiss cross fades in.
- Slide content: a 42 px round badge top left (token mark or split pair), up to four floating coins, then text at the bottom,
  padding 16: title Inter 14/18 500 white, body Inter 14/19 400 `#8f8e8e`.
- Slides seen: "Choose how to claim / Pick how your Points become FABLES." and "BUN is live! / LP in BUN/USDG to earn swap
  fees and points." Each launch has its own glow colour (lime, `#c09c7a`, `#ff2fd4`).
- Slide-in: opacity 0 to 1 and translateY 3 px to 0, 0.2 s.
- Under 576 px it becomes a full-width card (left and right 16), min-height 96.
- Showcase: keep the slot; it is the natural place for a rotating "clim is watching ETH/USDG" card (see §8).

### 1.5 Footer

- Width `min(100%, 1200 + 2 × 80)`, padding 48 80.
- Top row: brand block (logo + "Fables" Louize 32, then a 46 ch blurb Inter 14/20 `#bcbbbb`:
  "Dynamic fee ve(3,3) exchange on Uniswap v4, building pair-specific markets. Live on Robinhood Chain.") and, right
  aligned, three link columns with gaps 48 × 72:
  - Learn: Documentation, FAQ, Liquidity;
  - Rewards: Points, Creator Fee Rewards, Partner Rewards, PROLOGUE;
  - Resources: Brand kit, Security & Risks.
  - Column title Inter 14 weight 450, line-height 1.1, white; links Inter 14 weight 450, line-height 1.25, `#bcbbbb`,
    hover white (0.15 s); row gap 16, title to list 20.
- Bottom row (margin-top 96, right aligned): Terms of Service, Privacy Policy, Points Terms, then 20 px social icons
  (X, Telegram, Discord, CoinGecko, one more), gap 24. Hover tints: Discord `#5865f2`, Telegram `#229ed9`.
- Under 992 px: stacked, gutter 32; under 576 px: link columns hidden, gutter 10.

## 2. Pages

### 2.1 Landing `/`

Grid: content column 1200, sections stacked with gap 24 (`--s5`); total page about 2007 px tall at 1450.

1. **Hero card** (y 168, 1200 × 326):
   - background `#1a1919`, radius 12, padding 12, no shadow, overflow hidden;
   - art layer: `/hero-bg.webp` (storybook landscape: archer, trees, dragon, fox, unicorn) at 46 % opacity, `cover`, plus
     the 20 px dot grid on top;
   - inner column centred, padding 64 40 80, gap 24;
   - eyebrow chip 189 × 38: background `#2a2828`, border `rgba(255,255,255,.06)`, radius 12, padding 8 12, gap 10;
     an 8 px green dot `#66c399` with a ring pulse (scale 1 to about 2.4, opacity .6 to 0, 1.8 s ease-out, infinite);
     text "Live on Robinhood" Inter 14/20 500 with a 16 px lime feather icon before "Robinhood";
   - headline "Markets used to be dumb. That's over." Louize 48/56 500, tracking +0.24 px, centred; "That's over." in lime
     `#ccff00` (32/38 and a line break under 576 px);
   - subline Inter 14/20 500 `#8f8e8e`: "Because your assets deserve real market structure. A fully non-custodial ve(3,3) DEX,
     built on Uniswap v4 hooks", the link in `#bcbbbb`, underlined (offset 2), with a 14 px external-arrow icon, white on
     hover;
   - focus inside the hero: 2 px white outline, offset 3.
   - Under 576 px: eyebrow and subline hidden, two buttons appear ("Enter app", "Learn more", 44 tall, max 360 wide).
2. **Feature grid** (y 518): 3 columns × 384, gap 24 (one column under 769 px). Each card = plate (200 tall) then text
   (gap 24 between, gap 8 inside text):
   - plate: background `#1a1919` with dot grid, radius 12, shadow `0 0 0 1px rgba(255,255,255,.06), 0 8px 24px rgba(0,0,0,.5)`;
     a tag chip top left at 12/12 (same style as the eyebrow, 38 tall);
   - title Inter 16/24 500 -0.25 px white; description Inter 16/24 400 `#bcbbbb`;
   - card 1 "Intelligent fees", "Our pools ingest real-world cues on time, volatility and sentiment to reprice fees.":
     a square sun-icon tag, then a horizontal **fee ticker**: pills 105 × 36, radius 4, spaced 111 px, values like 0.04 %,
     0.33 %, 0.21 % in Inter 22/22 500 -0.5 px tabular, face `#2a2828` at 50 % opacity with `#bcbbbb` text; the centre
     pill lights up lime (`#ccff00` face, `#201d1d` text) as the track slides; edges fade with a horizontal mask
     (transparent, black 16 %, black 84 %, transparent); pills rise 28 px into place on reveal (1007 ms,
     `cubic-bezier(.16,1,.3,1)`);
   - card 2 "Rewarded for risk", "Pools adapted to their assets earn Liquidity Providers up to 2.1x more yield on identical
     risk.": NVDA/USDG pair tag; five rounded bars (36 wide, rx 8, grey gradient) and the last bar lit lime with a lime
     "2.1x" badge (Inter 12 600, `#201d1d`); bars rise and dip in loops;
   - card 3 "Multiple asset types", "RWA, bluechips, stables, memecoins and longer tail tokens, each with a tailor-made pool.":
     an orbit of blurred asset logos (Tesla, Apple, NVIDIA, Fables and others) around a lime centre disc.
3. **Featured markets** (y 910, margin-top 64): a 64 px unicorn illustration perched on the card's top right edge, then:
   - card: radius 12, shadow as the plates, inner surface `#1f1e1e` padding 8;
   - head: padding 4 12 12; title "Featured markets" Louize 24/32 500; right link "View all markets" (pill-in-pill:
     outer `#1a1919` radius 12 padding 2, inner 26 tall radius 10 padding 0 8, Inter 12/16 500 `#bcbbbb`, arrow nudges 2 px
     right on hover);
   - the markets table (component §3.6) with 5 rows: ETH/USDG, PONS/USDG, GLD/USDG, SPY/USDG, NVDA/USDG;
   - foot band (inside the card, 96 tall): canvas background, padding 20 28, a 56 px Uniswap mark with an animated halo,
     "Built on Uniswap v4" Inter 16/24 500 and "Hooks let a pool run custom logic on every swap" Inter 12/16 500 `#bcbbbb`;
     a secondary button "Learn More" right.
4. Footer (§1.5).

### 2.2 Markets list `/markets`

Column 1200, gap 48 between blocks.

1. **Head** (y 152): left, title "Markets" Louize 28/33.6 500 and description "Every Fables pool currently live and open to
   deposit into." Inter 14/18.9 `#8f8e8e`, gap 8. Right, header stats (`dl`, gap 32):
   - "Daily Fees" and "Lifetime Fees", each: label Inter 14/20 `#bcbbbb` + an 18 px info icon (tooltip), value Inter 24/24 500
     tabular, rolling digits (§3.13);
   - second stat has a left divider 1 px `rgba(255,255,255,.06)` and padding-left 32.
   - Tooltip copy: "Swap fees across listed Fables markets over the last 24 hours." and "Total swap fees across listed Fables
     markets since each pool began trading."
2. **Summary rail** (y 246): horizontal scroll-snap rail, gap 32, each card `(100% - 32) / 2` wide (584 px), 208 tall
   (`--market-summary-height`); 4 cards, 2 visible, the next ones reached by horizontal scroll:
   - "Total deposits" (area sparkline), "Total volume" (daily bars), "Fees (24h)", "Lifetime fees";
   - card: `#1f1e1e` with dot grid, radius 12, table shadow; head padding 12 16 4; label Inter 14/20 `#bcbbbb` + info icon;
     big value Inter 24/28.8 500 tabular rolling digits; caption line Inter 14/20 `#bcbbbb`;
   - plot box fills the rest (118 px): SVG `viewBox 0 0 600 100`, `preserveAspectRatio none`, colour lime;
     area: 2 px stroke (`vector-effect: non-scaling-stroke`) and a fill gradient lime 40 % to 0 %;
     bars: 28 daily bars, width 2.57 %, step 3.57 %, rx 4 with the bottom radius pushed below the baseline; the current
     day is hatched (45° stripes, 3 of 6 px, lime 50 %) and clipped at the projected height;
   - series reveal: clip-path from the left, 0.9 s `cubic-bezier(.65,0,.35,1)`.
   - Skeleton: label shows, value and plot are grey `rgba(255,255,255,.12)` blocks pulsing 1.5 s.
3. **Filter bar** (sticky under the header, canvas background, padding 32 32 16 with negative margins): left "All Assets"
   and "All Pool Types" selects; right "In Wallet" toggle, search, settings square.
   - control: height 36, background `#1f1e1e`, radius 12, shadow `0 2px 4px rgba(0,0,0,.15), 0 0 0 1px rgba(255,255,255,.1)`,
     Inter 14/14 500, padding 0 7 0 12, chevron 14 px `#8f8e8e`; hover `#2a2828`; pressed `#373434`; on (filtered)
     `#2a2828` with ring `rgba(255,255,255,.12)`; the label width animates 0.22 s and letters morph when the value changes;
   - dropdown (open state, measured): 256 wide, padding 5, radius 12, menu shadow, pops from 96 % scale and -4 px in 0.1 s.
     Items: min-height 32, padding 6, radius 7, gap 8, Inter 14 400 `#bcbbbb`, a radio circle; selected item white 500 with a
     lime check disc; separator 1 px `rgba(255,255,255,.08)` after the "All" item.
     Assets: All Assets, Real-world assets, Crypto, Memes, Other. Pool types: All Pool Types, Correlated, Volatile, Stable,
     New;
   - "In Wallet" toggle: control with a 36 × 20 switch (track `#373434`, ring `rgba(255,255,255,.12)`, 16 px thumb
     `#bcbbbb`; on: track lime, thumb `#201d1d` slid 100 %; hover nudges the thumb 14 %);
   - search: 251 × 36, padding 0 14, magnifier 17 px `#8f8e8e`, placeholder "Filter markets" Inter 14 500 `#8f8e8e`; focus
     ring `rgba(255,255,255,.12)`;
   - settings: 36 × 36 square control (sliders icon). Its menu holds "Swap Fees Only" (per the docs), not opened.
4. **Markets table card** (y 562): same card as the landing featured table, without the head. Columns: Market (365),
   TVL (199, sortable, sorted by default with a ⇕ icon), 1D vol (199), Pool APR (243), actions (177).
   15 rows per page, then a pager row: canvas background, radius 12, height 50, page buttons 32 × 32 radius 12
   (Inter 13/13 500; active `#2a2828`), "Next" button with chevron (label hidden under 901 px; "Previous" hidden when
   disabled).
   - Row copy: pair "ETH/USDG", asset badge "Ethereum | Crypto", TVL "$23.86M", volume "$75.72M", APR "100.61%" + Points pill.
   - Market order seen: ETH/USDG, PONS/USDG, GLD/USDG, SPY/USDG, NVDA/USDG, CASHCAT/USDG, AI/USDG, SPCX/USDG, ETH/AI,
     UBIK/USDG, AAPL/USDG, CRCL/USDG, ETH/PONS, ZZZ/USDG, ETH/CASHCAT (page 1 of 4). Crypto-crypto pairs show "2 Assets".

### 2.3 Pool page `/markets/eth` (ETH/USDG)

The market route uses the base symbol (`/markets/:symbol`). Chart state is in the query (`?chart=price|volume|liquidity|depth`).
Column: max 1200 with padding 144 80 64, so content is **1040 wide** (x 205 to 1245). Blocks: header, then a stack with gap 48,
sections separated by 1 px rules `rgba(255,255,255,.06)` (margin 4 0).

1. **Header** (gap 16):
   - "← Back" link Inter 14/20 `#bcbbbb`, 16 px arrow, white on hover;
   - identity row: split pair logo 61 × 61, then title "ETH / USDG" **Inter** 28/33.6 500 (not Louize) and a subtitle row
     Inter 14/20 500: Uniswap pink mark + "Uniswap v4", "on" (400, `#bcbbbb`), Robinhood lime mark + "Robinhood Chain";
   - actions right: primary "Deposit" 82 × 36 (white background, `#100f0f` text, radius 12, padding 0 16, button shadow,
     hover `#ebe9e9`) and a 36 × 36 "more" button. More menu (measured, 234 wide): "Copy ETH address", "Copy USDG address",
     "View ETH on RobinScan", "View USDG on RobinScan", "View market on Uniswap".
2. **Stat row** (5 equal columns of 182.4, gap 32, each with padding-right 32 and a right hairline; last without):
   - label Inter 14/20 `#bcbbbb` + info icon; primary Inter 24/28.8 500 tabular; secondary line Inter 14/20 `#bcbbbb`;
   - Total deposits "$23.85M", secondary delta "▼ 1.24%" (6 px CSS triangle, orange down, green up, value white);
   - 24H volume "$75.75M" "▲ 3.58%"; 24H fees "$65.91K"; Pool APR "100.85%";
   - **Current fee** "0.5%" with a tier badge "● Elevated" (badge 20 tall, `#2a2828`, radius full, padding 2 8, Inter 12/16
     500 `#bcbbbb`, 6 px dot). Dot colours by tier: market open `#66c399`, overnight `#d2a022`, weekend `#636161`,
     elevated (keeper override) `#55a7fb`. While loading the value is "-".
   - Tooltips: "The total value of all liquidity in this market", "Swap volume over the last 24 hours", "Fees paid to
     liquidity providers in the last 24 hours", "Annual percentage rate including swap fees and any additional rewards",
     and for the fee: "The fee this market is charging right now, raised above its schedule to protect liquidity providers."
     (override active) or "The fee this market charges on every swap right now" (no override). With an asymmetric fee the
     value becomes a buy and a sell figure, and the tooltip explains that "the two directions cost different amounts".
   - Under 1141 px: auto-fit columns min 150, no dividers; under 576 px: 2 columns.
3. **Price and activity** (section: title Inter 20/24 500, description Inter 14/20 `#bcbbbb` max 76 ch, gap 4; head to
   body 40):
   - aside grid `308px | 1fr` (container query ≥ 690 px), gap 40;
   - left rail (padding-top 8, gap 16): stat (label, value 24 px, secondary), divider, then period rows (Inter 14/20,
     label `#bcbbbb`, value white tabular, gap 6): Volume tab shows "Volume $362.44M Past week" then 1 day, 1 week, 1 month,
     1 year, All time. Price tab: "1 ETH = 2,484.97 USDG", "$2.48K", "▼ 3.58% Past week". Liquidity tab: "Liquidity in view
     $22.55M", "94.54% of pool liquidity", Current price, "Range in view 2,046.77 - 3,004.90". Depth tab: "Depth ±2% $6.23M",
     "26.13% of pool liquidity", Mid price, Fee "0.5%";
   - chart panel 692 × 327: background `#1a1919`, radius 12, overflow hidden. Top bar (padding 8 12 0): segmented switcher
     (Price, Volume, Liquidity, Depth; §3.9) and zoom group right (zoom in, zoom out, reset; 24 × 24, radius 4). Plot 249 tall
     with dot grid and a top and bottom fade. Legend bar 38 tall (top hairline): periods 1D, 1W, 1M, 1Y, All (24 tall,
     radius 4, Inter 12/16 500 `#bcbbbb`, active white, hover `#2a2828`), and right a denomination toggle "USDG per ETH ⇅";
   - charts: Volume = lime bars; Price = line + area in the direction colour (seen orange `#ff773d` for a down week; green for an up
     window is inferred, not observed), area gradient 40 % to 0 %; Liquidity = horizontal histogram (ETH side lime above price, USDG side grey below,
     dashed white "Current price" line, legend swatches 12 × 4); Depth = stepped bid (green) and ask (orange) curves with a
     gap at mid price labelled with **the current fee** ("0.5%");
   - X labels Inter 11 `#bcbbbb` ("Oct 9"), Y labels right-aligned Inter 11;
   - loading: the Fables mark (56 px, mask) pulsing between 30 % and 12 % opacity, centred;
   - reveal: series clip-path from the left in 0.9 s, axes fade 0.9 s.
4. **Pool balances**:
   - plate (`#1a1919`, radius 12, padding 24 32): two halves split by a hairline. Each: a 55 px ring gauge (lime arc on a dark
     track, percentage inside, "77%"), token icon 18 px + "ETH" + copy button, then "$18.36M of $23.85M" (Inter 24/28.8 500,
     "of" 18 px `#bcbbbb`) and "7,388.25462 ETH" Inter 14/20 `#bcbbbb`;
   - params card (2 columns of 500, padding 10 20; rows padding 10 0, odd rows with a right hairline): Pool ID
     "0xbac3...e551" (copy), PoolManager "0x8366...0951", Fee model "Dynamic", Tick spacing "10", Current price
     "2,484.83 USDG", Hook "0x06a8...6080". Labels `#bcbbbb` with dashed-underline tooltips; values 500 white; copy buttons
     `#bcbbbb`, white on hover.
5. **Dynamic Fee** (this is Fables' own fee panel, see §8):
   - title "Dynamic Fee", description "This market leverages dynamic fees to optimize rewards for liquidity providers.";
   - rail: "Current fee" 0.5 % with secondary "0.1007% average over 7d"; divider; rows (padding 6 0, Inter 14/20, label
     with dashed underline `rgba(255,255,255,.12)`, value 500 tabular): Peak "0.6%", Low "0.07%", Changes "1369",
     Volatility "111.81%". Row tooltips: "The dearest this market's fee has been in the last 7d", "The cheapest this market's
     fee has been in the last 7d", "How many times the keeper has moved this market's fee in the window", "The annualised
     volatility the keeper last measured, which is what sets the fee";
   - chart panel: top bar with "● Live" (8 px lime dot with the same ring pulse, Inter 12/16 500) and periods 24H, 7D
     (7D default); plot 249 tall: a **step line** (SVG `H`/`V` path) stroke lime 2 px, round joins, with an area gradient;
     X labels "Oct 7 … Oct 14";
   - hover: vertical crosshair `rgba(255,255,255,.12)`, a dot (lime fill, 2 px panel-coloured stroke), and a tooltip 200 wide
     (radius 12, padding 6 8 4, menu shadow): head "Oct 12, 3:23 AM" (Inter 12/16 500), rows "Fee 0.07%" and
     "Volatility 41.58%" (label `#bcbbbb`, value white tabular);
   - variants in CSS: `lineBuy` green and `lineSell` orange (asymmetric pools), a dashed "next change" marker in faint ink
     with "Now" and "Next change" labels (calendar pools), and a "stale" label.
6. **Recent transactions**: card `#1f1e1e`, radius 12, padding 20 20 12, table shadow. Header cells canvas, Inter 12/16 500
   `#8f8e8e`; rows 56 tall, row gap 8, hover canvas. Columns: Time (relative, "17s", "1m", with a hover title
   "10/14/26, 02:50pm"), Type (8 px dot: green for Add or Buy, orange for Remove or Sell; "Add", "Remove", "Buy ETH",
   "Sell ETH"), USD, ETH, USDG (right aligned, tabular), Wallet (truncated address, dotted underline, links to RobinScan).
   Footer: "See more ↓" Inter 14 500. Rows link to the explorer transaction.

### 2.4 Deposit flow `/deposit/:poolId?from=…` (the liquidity panel)

Opens full screen from "Deposit" (pool page, markets row, portfolio). Only step 1 was viewed.
- Top bar fixed: height 68, padding 16 24, canvas, bottom hairline; a close button 32 × 32 (`#8f8e8e`, hover white and
  `rgba(255,255,255,.06)`, scale 1.05).
- Column centred, max 528, gap 24, page padding 96 24.
- Steps: three 28 px rounded squares "1 2 3" (active lime with dark text, others `#2a2828`).
- Title "Select range" Inter 30/36 500; lead "Choose the price range for your new [ETH/USDG chip] position." Inter 14/20
  `#bcbbbb`.
- Range card (`#1a1919`, radius 12): switcher Price / Liquidity, zoom group; the liquidity histogram with a translucent lime
  band between Min and Max handles (white lines), dashed current price; Y labels right; denomination "USDG per ETH ⇅".
- Settings card (rows 48 tall, hairline `rgba(255,255,255,.08)` between, padding 0 4): "Range preset ⓘ" with a select "Wide",
  "Min price 2159.47 − +", "Max price 2857.21 − +", "Price 2,484.83" with the USDG mark, "Capital efficiency 14.8x",
  "Your APR ⓘ 33.62%".
- Buttons (each 256 × 44, radius 12): "Cancel" secondary (`#1f1e1e`, ring `rgba(255,255,255,.08)`), "Continue" primary
  (white, dark text). Transitions 0.18 s; press scale .99.
- Showcase: render this page read only (values from the chain, buttons disabled or routed to the recorded fork run).

### 2.5 Swap and 404

- No swap page in the app (`/swap` → 404). The "Zap" in the deposit flow swaps through Uniswap v4 and KyberSwap with a
  router fee (§2.10 copy). For the showcase, do not invent a swap page.
- 404: centred column, the fox-and-star logo mask 200 wide, three "?" glyphs bobbing and tilting (1.5 s), text
  "Sorry, we couldn't find that page." Inter 16/24 450 `#bcbbbb`, link "Back to Home" Inter 14 `#8f8e8e` fading in.

### 2.6 Portfolio `/portfolio` (layout only, placeholder values)

- Column 1200, gap 32. Greeting row: "Good afternoon!" (time-of-day greeting) Louize 40/46 500 -0.4 px (28 px under 576),
  right "Deposit" primary + a 32 px more button.
- Grid `1fr | 345px` (831 + 345 at 1450), gap 24; single column under 1101 px.
- Left column (gap 24):
  - **Portfolio value** card (831 × 322): chart panel with an overlay at 12/12: a "Portfolio value" chip and the value
    "$X,XXX.XX"; periods 1W (default), 1M, YTD, 1Y; lime area chart;
  - **Your positions** card: head "Your positions" Louize 24/32; table (min 620 wide) Market, APR, Fees, Balance (sortable),
    actions. Rows 72 tall on canvas, top hairline. Market cell: pair logo, pair link and a status pill ("In range" green,
    "Out of range" orange, "Claimable" lime; 24 tall, colour 12 % tint, 6 px dot); hovering the status shows a range card
    (Min price, Max price). Fees value green;
  - **Activity** card: head "Activity" + segmented filter All, Liquidity, Fees, Points; table Time, Type, Market, Tokens,
    Amount; points rows show a small star mark; pager.
- Right rail (gap 24):
  - "Redeem your Points" claim button 345 × 96 (`#1e1e1b`, lime glow at 80 %, floating coins, a badge "Decide by DD Oct");
  - Points card (`#1f1e1e`, padding 16, gap 12): 36 px lime mark, balance Inter 24/32 500, "Week N" with a progress bar
    (3 px: lime done weeks, amber current week), "Earning from" pair badges, link "Open points ›";
  - PROLOGUE card: star mark, balance, "Snapshot in Nd", three-segment timeline, body "Snapshot window opening in N days.",
    "Learn more ›".

### 2.7 Leaderboard `/portfolio/points` (layout only, placeholder values)

- Same greeting row and `1fr | 345px` grid as Portfolio.
- **Your points** panel (`#1f1e1e`, radius 12, padding 24, gap 24): heading Louize 24/32, a 36 px lime square mark and the
  balance Inter 36/36 500; a sleeping-dragon illustration (156 × 104) with coins at the top right; then a 3-stat bar:
  "Lifetime fees ⓘ" (green "+$X.XX"), "Rank" ("#N" and "of N ranked"), "Share" ("<0.001%" and "1.32B emitted").
  Tooltip: "Swap fees earned as of DD Oct, HH:MM UTC, updated daily around HH:MM UTC."
- **Leaderboard** card: head Louize 24/32; table Rank, Wallet, Lifetime fees, Deposits, Points (th Inter 12/16 500
  `#bcbbbb`, padding 12 24; rows 56, padding 0 24). The viewer's row is pinned first with a "You" outline chip and a
  1 px ring. Top three ranks get a 6 px medal dot: gold `#c9a227`, silver `#9aa0a6`, bronze `#a3703f`. Wallet = 20 px
  blockie + truncated address. Fees green, prefixed "+". Pager.
- Rail: claim button; "Referral link" panel (heading, "Share on X" pill link, two figures "Referrals" and
  "Referral points" Inter 24/32, a 44 tall copy box with the link); "Your referrer" panel with an address chip.

### 2.8 Vote / veFABLES

- "Vote" is a gated nav button: no route, nothing opens. The docs state that FABLES locking, voting and emissions are not
  live yet. Nothing to inventory beyond the nav item.

### 2.9 Brand `/brand`

Already summarised in spec §2 ("Fables' look"); layout measured here.
- Hero title "Brand" Louize 40/46 500 -0.4 px. Sections separated by a top hairline, padding-top 32, gap 40.
- Section head: title Inter 20/24 500, description Inter 14/20 `#bcbbbb`.
- Logo: 3-column tile grid, gap 24: Logo, Cutout, Mark in White and Black. Tile: `#1a1919`, 1 px hairline, radius 12, art
  area then a foot (padding 16, top hairline) with name (Inter 14/20) and variant (Inter 12/16 `#8f8e8e`), buttons
  "Copy SVG" and "Download".
- Symbols: FABLES ("Mark on brand green"), Prologue ("White on graphite"), Points ("Ink on brand green").
- Colour: a lime tile (min-height 260, padding 32, hex "#ccff00" at `clamp(40px, 7vw, 72px)` 500, caption "Brand green /
  Primary accent"), then rows Surface (Canvas, Card, Surface, Raised), Ink (Primary, Secondary, Muted, Faint),
  Signal (Positive, Negative, Accent, Session `#d2a022`). Swatches copy on click.
- Texture: "Dot grid / Shared UI texture", "Copy CSS".

### 2.10 Docs (`/docs/dynamic-fees`, `/docs/fees-and-apr`, `/docs/security-and-risks`)

Layout:
- Page padding `nav + banner + 56` 48 64; a left sidebar (x 232 to 452, rail 220) and a main column (x 500, 718 wide).
- Sidebar groups (label Inter 14 `#8f8e8e`): Introduction (Overview, Dynamic Fees, FAQ), Liquidity (Providing Liquidity,
  Managing Positions, Fees & APR), Rewards (Points, Creator Fee Rewards, Partner Rewards), FABLES (ve(3,3), Tokenomics,
  PROLOGUE), then Terms, Privacy, Points Terms. Leaf: 16 px icon + label, Inter 14/22 -0.09 px, padding 8 0, `#8f8e8e`,
  hover `#bcbbbb` (0.18 s), active white.
- Main: Inter 16/24 -0.09 px `#bcbbbb`. H1 Inter 24 600 -0.24 px white; lead margin-top 18; rule margin 24 0 48;
  H2 Inter 20 600 -0.33 px; inline links `#55a7fb` underlined (opacity .7 on hover); emphasis white 500.
- Tables: Inter 14/20, th 500 white on canvas, padding 16, row lines `rgba(255,255,255,.08)`, zebra rows `#1a1919`, wrapper
  radius 12; caption Inter 13/16 `#8f8e8e`.
- Callouts: radius 12, padding 10 12, Inter 14/21, tone at 12 % background; info `#55a7fb`, good green, warn amber 15 %,
  error orange. Example (security page, info): "Code is NEVER risk-free." in the tone colour.
- Prev / next cards at the bottom (top hairline, margin and padding 48).

Content relevant to clim (summarised, not copied):
- **Dynamic Fees**: each pool has an on-chain baseline (calendar schedule or resting fee); authorised keepers apply temporary
  adjustments within the pool's floor and cap, which expire on their own; some pools charge different buy and sell fees.
  A demo block "Dynamic fees in practice" has four tabs (FilterToggle) Volatility, Market hours, Buy / Sell, Stablecoins, a
  "View market ↗" link (Inter 13 `#8f8e8e`), a fee chart panel per example (ETH/USDG 24H/7D; NVDA/USDG with "Now" and
  "Next change" markers; AMC/USDG with green buy and orange sell lines; aUSD/frxUSD) and a caption under each
  (Inter 13/20 `#8f8e8e`). The keeper section says the keeper is an operator with no custody, bounded by floor and cap,
  with an emergency role that can clear an override, and that the autonomous model resumes if the keeper stops.
- **Fees & APR**: a "Fees at a glance" table (swap fee dynamic within limits; Fables claim fee 10 %, 0 % on ETH/USDG,
  GLD/USDG and SPY/USDG, cap 20 %; Uniswap protocol fee 0; Zap router fee 0.05 %, cap 0.5 %; gas), then APR definitions
  (pool swap APR = average daily swap fees ÷ current TVL × 365, no compounding).
- **Security & Risks**: hooks immutable and non-custodial; admin keys only touch fees, capped in bytecode (0.30 % to 5 %
  across markets); a compromised keeper "can still misprice fees inside its band until an override is cleared or
  expires"; "Model, reference data, and keeper risk" lists stale or manipulated reference prices and miscalibrated
  volatility models, and that a stopped keeper falls back to the autonomous fee.

## 3. Component catalog

Each entry: anatomy, measured spec, states. Tokens refer to §4.

1. **Card shell.** Radius 12, overflow hidden, `--shadow-table` (`0 0 0 1px rgba(255,255,255,.06), 0 8px 24px rgba(0,0,0,.5)`),
   bottom border `1px solid rgba(255,255,255,.08)`; inner surface `#1f1e1e` padding 8. Dot-grid variant adds
   `radial-gradient(circle, rgba(255,255,255,.06) 1px, transparent 1px)` at 20 × 20.
2. **Chart panel.** `#1a1919`, radius 12, column: top bar (padding 8 12 0), plot (dot grid, min 100), legend or bottom
   bar (38 tall, top hairline). Inside a panel the tokens are remapped one step darker (canvas → `#1f1e1e`,
   surface → `#1a1919`, card → `#2a2828`).
3. **Segmented switcher (FilterToggle).** Root inline-flex, gap 2, track `#1f1e1e`, 1 px `rgba(255,255,255,.06)`, padding 2,
   radius 12; an absolutely positioned highlight (`#2a2828`, radius 9) slides to the active item via `--highlight-left` and
   `--highlight-width`. Item: 26 tall, padding 0 8, Inter 12/16 500, `#bcbbbb`, active and hover white, colour 0.3 s.
   36 tall under 576 px. Uses `role="radiogroup"` with `role="radio"` buttons.
4. **Period buttons.** 24 tall, padding 4 8, radius 4, Inter 12/16 500 `#bcbbbb`; on: white; hover: `#2a2828` background.
5. **Zoom buttons.** 24 × 24, radius 4, `#bcbbbb`; hover `#2a2828` and white; disabled `#8f8e8e` at 50 %.
6. **Row table (markets, transactions).** `border-collapse: separate; border-spacing: 0 8px`; thead cells 50 tall, canvas
   background, Inter 12/16 500 `#8f8e8e`, padding 12 16, rounded 12 on the outer cells; body cells `#1f1e1e`, padding 0 16,
   radius 12 on the first and last cell, height 76 (markets) or 56 (others); hover row = canvas background, 0.2 s.
   Row actions (more, deposit) fade in on hover or focus-within (opacity 0 → 1, 0.2 s); chevron box 32 × 32 radius 12,
   hover `#373434`. Horizontal overflow shows edge fades (40 px gradients) when there is more to scroll.
7. **Pair logo.** Two token images clipped to halves of one circle (`--pair-logo` 28 default, 40 in tables, 61 on the pool
   page, 18 in chips), halves `size / 2 - 1` px wide so a 2 px gap shows; fallback letters Inter 12 500 `#bcbbbb`.
8. **Asset badge.** 20 tall chip, `rgba(255,255,255,.09)`, radius full, padding 2 6 2 4, gap 6, Inter 10/10 500 white:
   12 px mark, name, then class after a 1 px `#8f8e8e` divider ("Ethereum | Crypto").
9. **Points pill.** 20 tall, lime, radius full, padding 2 8 2 3, Inter 10/10 600 `#201d1d`, 12 px star mask
   (`/prologue-star.png`). Tooltip "Earn points on the swap fees your liquidity earns, until 19 October."
10. **Tier badge.** 20 tall, `#2a2828`, radius full, padding 2 8, gap 8, Inter 12/16 500 `#bcbbbb`, 6 px dot by tier
    (open green, overnight amber, weekend faint, elevated blue).
11. **Tooltip (info).** Trigger 18 × 18 info icon (28 × 28 hit area on mobile). Bubble max 300, `#1f1e1e`, 1 px
    `rgba(255,255,255,.06)`, radius 12, padding 8 12, Inter 12/16 white, `white-space: pre-line`, shadow
    `0 6px 32px rgba(0,0,0,.35)`, a small arrow; shows above (or below with `data-below`) after a 0.3 s delay, opacity and
    2 px translate in 0.2 s `cubic-bezier(.16,1,.3,1)`; hides immediately.
12. **Chart tooltip.** Min 200 wide, radius 12, padding 6 8 4, background one step darker than the panel, menu shadow:
    head (date 500 white, time `#bcbbbb`), optional rule, rows (label with 8 px colour dot, value white tabular).
13. **Rolling digits (DigitRoll).** Each digit is a 1-character-wide wheel (`overflow: hidden`, vertical mask
    transparent → black 20 % / 80 % → transparent) holding a vertical strip 0 to n that translates to the target digit;
    separators and units are static; an `sr-only` copy holds the real value. Used on markets header stats and summary cards.
14. **Stat block.** Label (Inter 14/20 `#bcbbbb` + info), primary (Inter 24/28.8 500 tabular), secondary (Inter 14/20
    `#bcbbbb`, may hold a delta or a badge). Delta: 6 × 5 px CSS triangle, green up, orange down, value white.
15. **Buttons.**
    - Primary: white `#fff`, text `#100f0f`, radius 12, 36 tall (header and page) or 44 (flows), padding 0 16, shadow
      `0 2px 6px rgba(0,0,0,.45)`; hover `#ebe9e9`; disabled 30 %.
    - Secondary: `#1f1e1e`, white text, ring `rgba(255,255,255,.08)`, button shadow; hover overlay `rgba(255,255,255,.06)`.
    - CTA (landing foot): secondary look, padding 10 16; hover adds ring `rgba(255,255,255,.12)`.
    - Control (filters): see §2.2.
    - Icon button: 36 × 36 (32 in rows), radius 12, transparent, hover `rgba(255,255,255,.06)` or `#373434`.
    - Every button and link: `:active { scale: .99 }` in 0.1 s (`--press-scale`; .96 for small icon buttons).
    - Focus: `outline: 1px solid #55a7fb; box-shadow: 0 0 0 2px rgba(85,167,251,.3)`.
16. **Menu / dropdown.** See §1.3 and §2.2. Mobile: menus become a bottom sheet (max 380 wide, inset 16, items 44 tall,
    backdrop `rgba(0,0,0,.55)`, enter 0.15 s with `cubic-bezier(.16,1,.3,1)` and 8 px rise).
17. **Switch.** 36 × 20 track `#373434`, 16 px thumb `#bcbbbb` at 2 px inset; on: lime track, `#201d1d` thumb at 100 %;
    hover nudges the thumb 14 % (86 % when on); 0.15 s `cubic-bezier(.4,0,.2,1)`.
18. **Search field.** 36 tall (44 on mobile, 16 px text to stop iOS zoom), padding 0 14, `#1f1e1e`, radius 12, control shadow,
    focus ring `rgba(255,255,255,.12)`.
19. **Pager.** Canvas bar, radius 12, min-height 50, padding 0 9; page buttons 32 × 32 transparent, active `#2a2828`; ellipsis
    `#8f8e8e`; "Next ›" button.
20. **Skeleton.** `rgba(255,255,255,.12)` blocks, radius full for text lines, radius 12 for plots, opacity pulse 1 → .4 → 1 in
    1.5 s ease-in-out. Chart loading uses the pulsing logo mark instead.
21. **Empty state.** 48 px icon tile (`#1a1919`, hairline, radius 12) with three concentric rounded rings (64, 80, 96 px,
    opacity .75, .5, .25), body Inter 14/20 `#bcbbbb` max 34 ch.
22. **Callout.** See §2.10.
23. **Banner, promo toast, footer.** See §1.2, §1.4, §1.5.
24. **Live indicator.** 8 px lime dot with a ring that scales to 2.4 and fades, 1.8 s ease-out, infinite; label Inter 12/16
    500 "Live".
25. **Status toast (transactions).** Centred bottom pill 44 tall, `#1f1e1e`, ring `rgba(255,255,255,.12)`, Inter 14/20 500:
    spinner (14 px, green), check or cross icon popping in 0.2 s; a celebration variant with a bobbing frog and confetti.
    Not needed for the showcase (no transactions).

## 4. Token sheet

Merges spec §2 "Fables' look" and `.local/research-2026-10-13/fables-brand/` with what was measured. Names are Fables' CSS
variable names, useful as the rebuild's own token names.

### 4.1 Colour

| Token | Value | Use |
|---|---|---|
| `--dark-canvas` / `--canvas` | `#100f0f` | page, table heads, hovered rows |
| `--dark-card` / `--card` | `#1a1919` | hero, plates, chart panels |
| `--dark-surface` / `--surface` | `#1f1e1e` | cards, controls, menus, table rows |
| `--dark-control-tertiary` (Raised) | `#2a2828` | chips, active nav chip, active page |
| `--dark-control-tertiary-hover` | `#373434` | pressed control, icon hover, switch track |
| `--dark-ink` | `#ffffff` | primary text |
| `--dark-ink-secondary` | `#bcbbbb` | labels, body copy |
| `--dark-ink-muted` | `#8f8e8e` | table heads, descriptions, placeholders |
| `--dark-ink-faint` | `#636161` | icons, faint marks |
| `--dark-line-light` | `rgba(255,255,255,.06)` | hairlines, dot grid, borders |
| `--dark-line` | `rgba(255,255,255,.08)` | separators, button rings |
| `--dark-line-interactive` | `rgba(255,255,255,.12)` | focus-within rings, crosshair |
| `--dark-hover` | `rgba(255,255,255,.06)` | hover fills |
| `--dark-chip-fill` | `rgba(255,255,255,.09)` | asset badge, address chips |
| `--dark-skeleton` | `rgba(255,255,255,.12)` | skeletons |
| `--brand` | `#ccff00` | accent, charts, active states |
| `--dark-brand-fg` | `#201d1d` | text on lime |
| `--dark-positive` | `#66c399` | up, add, buy, in range, fees earned |
| `--dark-negative` | `#ff773d` | down, remove, sell, out of range |
| `--dark-accent` | `#55a7fb` | focus, links, info, "Elevated" fee dot |
| `--dark-focus-ring` | `rgba(85,167,251,.3)` | focus halo |
| `--dark-tier-overnight` (Session) | `#d2a022` | overnight tier, warnings |
| `--extension` | `#ffaf40` | current-week bar, warnings on tokens |
| `--dark-control-primary` / hover | `#ffffff` / `#ebe9e9` | primary buttons |
| banner and claim ground | `#1e1e1b` | claim surfaces, with lime glow `rgb(171 199 65 / .2)` |
| medals | `#c9a227`, `#9aa0a6`, `#a3703f` | leaderboard top 3 |

### 4.2 Shadows

| Token | Value |
|---|---|
| `--shadow-table` | `0 0 0 1px rgba(255,255,255,.06), 0 8px 24px rgba(0,0,0,.5)` |
| `--shadow-pill` | `0 2px 8px rgba(0,0,0,.4)` |
| `--shadow-button` | `0 2px 6px rgba(0,0,0,.45)` |
| `--shadow-menu-flat` | `0 6px 32px rgba(0,0,0,.35)` |
| `--shadow-menu` | `0 0 0 1px rgba(255,255,255,.1), 0 6px 32px rgba(0,0,0,.35)` |
| `--shadow-toggle` | `0 0 0 1px rgba(255,255,255,.12)` |
| control shadow (filters) | `0 2px 4px rgba(0,0,0,.15), 0 0 0 1px rgba(255,255,255,.1)` |

### 4.3 Type

- Families: `--font-display: "Louize", serif` (205TF Louize Display Medium, only weights 400 to 700 mapped to the one
  medium file, Basic Latin range); `--font-text: "Inter", "Inter Fallback" (Arial at 107.89 %), system`.
  Files in `.local/research-2026-10-13/fables-brand/fonts/`. No monospace anywhere; numbers use
  `font-variant-numeric: lining-nums tabular-nums`.
- Louize is used for: brand wordmark, landing headline, page titles (Markets 28, Brand and greetings 40), card titles
  ("Featured markets", "Your positions", "Leaderboard", "Your points", 24/32). Everything else, including the pool title
  and section titles, is Inter.
- Scale:

| Token | Size / leading / tracking |
|---|---|
| `--text-xs` | 10 / 10 / -0.11 px |
| `--text-sm` | 12 / 16 / -0.13 px |
| `--text-md` | 14 / 20 / -0.22 px (body default) |
| `--text-lg` | 16 / 24 / -0.25 px |
| `--header-md` | 20 / 24 |
| `--header-lg` | 24 / 32 |
| `--header-xl` | 36 / 40 |
| `--hero-title` | 48 / 56 / +0.24 px (32 / 38 / +0.16 px on mobile) |
| stat primary | 24 / 1.2, weight 500 |
| page title | 28 / 1.2 (Markets, pool pair) |
| greeting / brand hero | 40 / 1.15 / -0.4 px |
| flow title | 30 / 36 |
| docs body | 16 / 24 / -0.09 px |

- Weights: 400 body, 450 footer and pair badges, 500 labels and values, 600 docs headings and lime pills.

### 4.4 Space, radius, size

- Space: `--s0` 2, `--s1` 4, `--s1-5` 6, `--s2` 8, `--s2-5` 10, `--s3` 12, `--s4` 16, `--s4-5` 20, `--s5` 24, `--s5-5` 28,
  `--s6` 32, `--s7` 40, `--s8` 64.
- Radius: `--radius` 12 (everything), `--radius-compact` 4 (period buttons, fee pills, small focus), `--radius-full` 9999,
  `--radius-highlight` 9 (`12 - 2 - 1`, segmented highlight), nav chip 5 (`12 - 6 - 1`), menu items 7.
- Sizes: `--nav-h` 80 (60 mobile), `--banner-height` 40 (56 mobile), `--row-height` 56 (76 in market tables),
  `--thead-height` 50, `--row-gap` 8, `--market-summary-height` 208, `--max-width` 1200, flow column 528,
  `--flow-gap` 24 (20 mobile), `--page-header-gap` 32 (24 mobile).
- Texture: `--dot-grid-image: radial-gradient(circle, rgba(255,255,255,.06) 1px, transparent 1px)`, size 20 × 20.

### 4.5 Motion

- `--dur` 0.2 s, `--dur-fast` 0.15 s, `--dur-press` 0.1 s; `--ease` ease; `--ease-std` `cubic-bezier(.4,0,.2,1)`;
  `--ease-entrance` `cubic-bezier(.16,1,.3,1)`.
- Press: `scale: .99` (0.96 on small icon buttons) for 0.1 s on every button and link.
- Chart reveal: clip-path inset from the right to 0 in 0.9 s `cubic-bezier(.65,0,.35,1)`; axes fade 0.9 s ease-out.
- Tooltips: 0.3 s show delay, 0.2 s entrance easing. Menus: 0.1 s pop from 96 %. Bottom sheet: 0.15 s rise 8 px.
- Pulses: live and hero dots 1.8 s ease-out ring; skeleton 1.5 s; chart logo 30 % ↔ 12 %.
- Header and banner slide 0.2 s ease-in-out on scroll.
- Landing illustrations: fee pills rise 1007 ms; bars rise, float and dip (`svb-*` keyframes); characters rise from
  130 px, bob 3 px and drift (`rise`, `bob`, `ghost-drift`).
- `prefers-reduced-motion: reduce` collapses every animation and transition to 0.01 ms and removes press scaling.

## 5. Copy, numbers and dates

- Voice: short, plain British English ("annualised", "dearest", "colour"), second person, calm. Tooltips are one full
  sentence without a final period on stat labels and with one on longer notes. Storybook flavour only in art and the
  "Prologue" naming.
- Money: `$` + 2 decimals + K/M/B suffix ("$23.79M", "$425.79K", "$3.01B", "$65.91K"); small amounts plain ("$33.53",
  "$0.11"). Gains prefixed "+" ("+$X.XX").
- Percent: 2 decimals for APR, volatility and deltas ("100.61%", "111.81%", "1.24%"); fees trimmed to significant digits
  ("0.5%", "0.07%", "0.6%"), averages to 4 decimals ("0.1007% average over 7d"); tiny shares "<0.001%". Fees are shown in
  percent, never in bp.
- Counts: raw integers without separator in the fee panel ("1369"); thousands separators elsewhere ("7,388.25462 ETH",
  "2,484.83 USDG"); token amounts up to 5 decimals; compact token units ("5.50M USDG").
- Prices: "1 ETH = 2,484.97 USDG", unit "USDG per ETH" with a ⇅ toggle; ranges "2,046.77 - 3,004.90" (spaced hyphen);
  multipliers "14.8x", "2.1x".
- Deltas: CSS triangle + absolute percentage ("▼ 1.24%"), colour on the triangle only.
- Time: relative in tables ("17s", "1m", "2m", "Nh"); absolute on hover "10/14/26, 02:50pm"; chart axes "Oct 9";
  chart tooltip "Oct 12, 3:23 AM"; windows "Past week", "24H", "7D", "1D 1W 1M 1Y All", "1W 1M YTD 1Y"; data stamps
  "as of 14 Oct, 02:00 UTC, updated daily around 03:00 UTC"; countdowns "Snapshot in Nd".
- Missing values: "-".
- Addresses: `0x` + 4 + "..." + 4 ("0xbac3...e551"), copy buttons beside.
- Muted decimals: not seen on these surfaces in this build (values are uniformly white or `#bcbbbb`). The only dimming class
  found is `.dim` (ink faint) in chart tables. Spec §2's "muted decimals" should be treated as unconfirmed.

## 6. Responsive behaviour (from the stylesheets)

| Breakpoint | Change |
|---|---|
| ≤ 1279 / 1023 / 719 | banner coins thin out, then disappear |
| ≤ 1140 | pool stat row becomes auto-fit (min 150), no dividers |
| ≤ 1100 | nav pill hidden (items move into the menu); portfolio and leaderboard grid single column; brand text 28 |
| ≤ 991 | header and page side padding 80 → 32; footer stacks |
| ≤ 900 | markets summary cards min(100 %, 480 px) wide; pool balances halves stack; pager labels hidden |
| ≤ 768 | landing feature grid one column; markets page padding 20; filter bar wraps (search full width) |
| container < 690 | pool section aside becomes one column (rail above chart) |
| ≤ 640 | pool params one column; transaction card loses its shell |
| ≤ 575 (mobile) | `--nav-h` 60, banner 56; header padding 10; hero hides eyebrow and subline, shows two 44 px buttons; feature cards become self-contained cards with text first; every table becomes stacked cards (12 px gap, padding 16, label before value via `data-label`); market rows: pair + APR on top, TVL and volume rows, full-width "Deposit" button; tap targets 44 px; menus become bottom sheets; periods stretch full width; footer link columns hidden |
| ≤ 420 / 359 | position table loses margins; brand text visually hidden |

Hover styles are wrapped in `@media (hover: hover) and (min-width: 576px)`, so touch devices never get sticky hovers;
`(hover: none)` keeps row actions visible and sort icons on.

## 7. Assets

- Already local: `.local/research-2026-10-13/fables-brand/` (logos, marks, token SVGs, hero landscape, dragon, unicorn,
  chest icons, prologue star, Points coins, Louize and Inter woff2, favicon, OG image).
- Seen live but not saved: per-token images under `/tokens/*.png|svg` and `/logos/*.png`, launch toast badges, Uniswap and
  Robinhood marks in the pool subtitle.
- Showcase rule: use these only inside the non-affiliated showcase with the permanent banner; never on a page that could
  pass as Fables.

## 8. Where clim fits

Principle: graft clim into slots Fables already has, keep their grid, and label every clim element "clim" so nothing reads as
Fables' own data.

| Page | Slot | What clim adds | Why it fits |
|---|---|---|---|
| Header | right cluster (account chip slot) | "clim × Fables" mark + "Showcase, not affiliated" chip | the chip slot is empty in a no-wallet showcase |
| Banner | announcement bar (selection variant) | permanent non-affiliation line, same 40 px bar | the bar already exists on every page |
| Landing | feature card 1, fee ticker | keep the ticker but feed it the live keeper override and clim's recommendation side by side (two lit pills) | the card is literally "Intelligent fees" |
| Landing | featured table, foot band | "Verified by clim" band in place of "Built on Uniswap v4", link to `/evidence` | same 96 px band and CTA |
| Markets | table, after Pool APR | a narrow "Fee" column: current fee + tier badge + "Fee source" (Keeper / Schedule / clim) | the tier badge component already carries the source idea |
| Markets | summary rail | a fifth card "Keeper overrides (24h)" or "clim vs keeper" sparkline | the rail scrolls and already holds 4 cards |
| Pool (ETH/USDG) | stat row, "Current fee" cell | secondary line: "clim: X.XX%" under the tier badge; tooltip explains | same stat block, secondary slot |
| Pool | **Dynamic Fee section** (main graft) | add a clim series to the fee chart (second line, e.g. white or blue, plus a per-direction pair using their existing `lineBuy` green and `lineSell` orange), tooltip rows "Keeper", "clim", "σ", "Gap"; extra rail rows "clim now", "Toxic side", "Venue gap", "Last attestation" | the panel, rows, tooltip rows and buy/sell line styles already exist |
| Pool | Depth chart | a second fee gap marker (clim's per-direction fee) beside the "0.5%" label | the depth gap is the fee, visually |
| Pool | params card | rows "Risk desk" (contract), "Poker role" (address), with copy buttons | same `paramRow` |
| Pool | a new section between Dynamic Fee and Recent transactions | "Verifiable volatility desk" section, same section head and aside grid: rail of clim stats, panel with the CRE report timeline | follows their section rhythm (rule, head, aside) |
| Pool | recent transactions | a "Fee updates" filter or rows of `pokeFee` calls with type dots (blue for keeper, lime for clim) | same table, same type dot |
| Deposit step 1 | settings card | read-only row "Fee now / clim" next to "Your APR" | settings rows are generic |
| Docs | Dynamic Fees demo tabs | a fifth tab "clim" or a callout (info tone) under "The off-chain keeper" linking to `/integrate` | the demo uses FilterToggle tabs and captions |
| Promo toast | bottom-left rotating card | slides "clim is watching ETH/USDG", "Last CRE report 30 s ago" | the toast rotates launches already |

Do not graft into Portfolio or Leaderboard: they are wallet pages, and the showcase has no wallet.

## 9. Open questions for the rebuild

- Confirm the mobile specs on a real 390 px device once the showcase exists (not observable from the maintainer's window).
- Swap: decide whether the showcase needs any swap visual at all (Fables has none outside the Zap flow).
- Muted decimals: spec §2 mentions them; not seen live. Drop unless another source shows them.
- The keeper fee chart's area gradient references `--accent`; visually the area reads as a dark lime wash. Check against the
  screenshot `.local/fables-ui/04-pool-eth-dynamic-fee.jpg` when matching.
