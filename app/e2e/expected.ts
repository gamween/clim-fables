// The live keys each route must show once its reads have landed, shared by the live check (live.spec.ts) and the load
// timing (perf.spec.ts).
const fee = (p: string) => [`${p}:fee0For1`, `${p}:fee1For0`];
const window = (p: string) => [`${p}:avg`, `${p}:peak`, `${p}:low`, `${p}:changes`];
const pool = (n: string) => [...fee(`pool:${n}`), `pool:${n}:price`, ...window(`pool:${n}`), `pool:${n}:swaps`];

export const EXPECTED: Record<string, string[]> = {
  "/": ["fables:fee0For1", "clim:quote", "clim:seq"],
  "/markets": [...fee("fables"), "fables:price", "fables:changes", "fables:avg", "clim:avg", "clim:seq", ...["D", "K", "F"].flatMap((n) => [...fee(`pool:${n}`), `pool:${n}:price`])],
  "/markets/eth": [...fee("fables"), "fables:price", ...window("fables"), "clim:quote", ...fee("clim"), "clim:mode", "clim:seq", "clim:tObs", "desk:sigma5", "desk:dev"],
  "/markets/d": [...pool("D"), "pool:D:meanSwapFee"],
  "/markets/k": [...pool("K"), "pool:K:meanSwapFee"],
  "/markets/f": [...pool("F"), "pool:F:meanSwapFee"],
  "/integrate": ["fables:fee0For1", "clim:quote", "roles:poker", "roles:runner"],
};

/** Chart series a route draws once its history is in (StepChart's path[data-series]); an empty list means any series. */
export const EXPECTED_SERIES: Record<string, string[]> = {
  "/markets/eth": ["keeper", "clim"],
  "/markets/d": [],
  "/markets/k": [],
  "/markets/f": [],
};
