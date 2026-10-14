import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { inlineMd, resolveHref } from "./inlineMd";

describe("resolveHref", () => {
  it("points a relative link at the file on GitHub", () => {
    expect(resolveHref("../../cre/README.md", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/blob/main/cre/README.md");
    expect(resolveHref("keeper-read.ts", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/blob/main/docs/integrate/keeper-read.ts");
    expect(resolveHref("sessions/2026-10-14.md", "docs")).toBe("https://github.com/gamween/clim-fables/blob/main/docs/sessions/2026-10-14.md");
  });
  it("keeps anchors and folders", () => {
    expect(resolveHref("../../shared/abis/", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/tree/main/shared/abis");
    expect(resolveHref("README.md#gas-and-cost", "docs/integrate")).toBe("https://github.com/gamween/clim-fables/blob/main/docs/integrate/README.md#gas-and-cost");
  });
  it("leaves absolute links alone", () => expect(resolveHref("https://x.y/z", "docs")).toBe("https://x.y/z"));
});

it("renders code and links, and nothing else", () => {
  const html = renderToStaticMarkup(<p>{inlineMd("see [`keeper-read.ts`](keeper-read.ts) and `max` <b>", "docs/integrate")}</p>);
  expect(html).toBe(
    '<p>see <a href="https://github.com/gamween/clim-fables/blob/main/docs/integrate/keeper-read.ts" target="_blank" rel="noreferrer"><code>keeper-read.ts</code></a> and <code>max</code> &lt;b&gt;</p>',
  );
});
