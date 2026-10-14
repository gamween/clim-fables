import { describe, expect, it } from "vitest";
import { liveText } from "./liveKeys";

describe("liveText", () => {
  it("formats each kind of key", () => {
    expect(liveText("fables:fee0For1", "3303")).toBe("0.3303%");
    expect(liveText("pool:D:peak", "6000")).toBe("0.6%");
    expect(liveText("clim:quote", "1368")).toBe("0.1368%");
    expect(liveText("fables:avg", "1027.1256712962963")).toBe("0.1027%");
    expect(liveText("fables:price", "3939955770818462841585330")).toBe("2,473.00");
    expect(liveText("pool:D:swaps", "1070")).toBe("1,070");
    expect(liveText("clim:seq", "563")).toBe("563");
    expect(liveText("clim:mode", "normal")).toBe("Normal");
    expect(liveText("clim:tObs", "1791985251")).toBe("13:40:51 UTC");
    expect(liveText("desk:sigma5", "105778")).toBe("59.40%");
    expect(liveText("desk:dev", "-1800")).toBe("-0.18%");
    expect(liveText("roles:poker", "true")).toBe("yes");
  });
  it("refuses a key it does not know", () => expect(() => liveText("fables:tvl", "1")).toThrow("unknown live key"));
});
