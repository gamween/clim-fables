"""Raw data for the clim x Fables studies (network, read only). Writes lab/data/fables2/.

    uv run python scripts/fables_fetch.py blocks [--step 600]     # (block, timestamp) samples over the window
    uv run python scripts/fables_fetch.py check-clock               # interpolation error on 300 random blocks
    uv run python scripts/fables_fetch.py logs                      # FeePoked, PokeCleared, PoolConfigured of the hook
    uv run python scripts/fables_fetch.py binance                   # Binance ETHUSDT 1 s, one CSV per day
    uv run python scripts/fables_fetch.py usdt                      # Coinbase USDT-USD 1 min

Every subcommand resumes: files already written are kept unless --refresh. The Etherscan key comes from
ETHERSCAN_API_KEY or the ETHERSCAN_API_KEY= line of contracts/.env and is never printed or written.
"""

import argparse
import io
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from clim_lab import fables as fb
from clim_lab import robin, venue
from clim_lab.data import DATA_DIR, LAB_DIR, OUT_DIR
from clim_lab.report import now_iso, write_json

RAW = DATA_DIR / "fables2"
START = 1_788_739_200  # 2026-09-07 00:00 UTC
END = 1_791_763_200  # 2026-10-12 00:00 UTC
PAD_BEFORE = 3_600  # one hour of venue history before START for the volatility windows
PAD_AFTER = 600  # markouts look up to 300 s ahead
RPC = os.environ.get("RH_MAINNET_RPC_URL", "https://rpc.mainnet.chain.robinhood.com")
ETHERSCAN = "https://api.etherscan.io/v2/api"
UA = {"User-Agent": "clim-lab/0.1 (research, read only)"}


def _get(url: str, timeout: int = 60) -> bytes:
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # network hiccups and 429s: back off and retry
            if attempt == 5:
                raise
            print(f"  retry {attempt + 1} after {type(e).__name__}", file=sys.stderr)
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def _rpc(batch: list[dict]) -> list[dict]:
    body = json.dumps(batch).encode()
    for attempt in range(8):
        try:
            req = urllib.request.Request(RPC, data=body, headers={**UA, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                out = json.loads(r.read())
            if isinstance(out, dict):
                raise RuntimeError(f"RPC error: {out.get('error')}")
            bad = [x.get("error") for x in out if "result" not in x or x["result"] is None]
            if bad:  # rate-limited items come back as per-item errors: retry the whole batch
                raise RuntimeError(f"{len(bad)} batch items failed: {bad[0]}")
            return sorted(out, key=lambda x: x["id"])
        except Exception as e:
            if attempt == 7:
                raise
            print(f"  rpc retry {attempt + 1} after {type(e).__name__}", file=sys.stderr)
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def _blocks(numbers: list[int]) -> list[tuple[int, int]]:
    batch = [
        {"jsonrpc": "2.0", "id": i, "method": "eth_getBlockByNumber", "params": [hex(n), False]}
        for i, n in enumerate(numbers)
    ]
    return [(int(r["result"]["number"], 16), int(r["result"]["timestamp"], 16)) for r in _rpc(batch)]


def _latest() -> int:
    return int(_rpc([{"jsonrpc": "2.0", "id": 0, "method": "eth_blockNumber", "params": []}])[0]["result"], 16)


def _block_at_or_after(t: int, lo: int, hi: int) -> int:
    while lo < hi:
        mid = (lo + hi) // 2
        if _blocks([mid])[0][1] < t:
            lo = mid + 1
        else:
            hi = mid
    return lo


def cmd_blocks(args) -> None:
    out = RAW / "blocks.json"
    partial = RAW / "blocks.partial.json"
    if out.exists() and not args.refresh:
        print(f"{out} exists (use --refresh)")
        return
    hi = _latest()
    first = _block_at_or_after(START - PAD_BEFORE, robin.HOOK_DEPLOY_BLOCK, hi)
    last = _block_at_or_after(END + PAD_AFTER, first, hi)
    numbers = list(range(first, last + 1, args.step))
    if numbers[-1] != last:
        numbers.append(last)
    RAW.mkdir(parents=True, exist_ok=True)
    # resumable: Alchemy's free tier allows ~330 compute units/s (16 per block read), so pace batches and keep progress
    rows: list[tuple[int, int]] = [tuple(r) for r in json.loads(partial.read_text())] if partial.exists() else []
    done = {r[0] for r in rows}
    todo = [n for n in numbers if n not in done]
    for i in range(0, len(todo), args.batch):
        rows += _blocks(todo[i : i + args.batch])
        time.sleep(args.pause)
        if (i // args.batch) % 50 == 0:
            partial.write_text(json.dumps(rows))
            print(f"  {len(rows)}/{len(numbers)} samples", flush=True)
    rows.sort()
    out.write_text(json.dumps(rows))
    partial.unlink(missing_ok=True)
    print(f"wrote {out}: {len(rows)} samples, blocks {first}..{last}, step {args.step}")


def cmd_check_clock(args) -> None:
    clock = robin.BlockClock.from_json(RAW / "blocks.json")
    rng = random.Random(20261013)
    picks = sorted(rng.randrange(int(clock.block[0]), int(clock.block[-1])) for _ in range(300))
    exact = []
    for i in range(0, len(picks), 10):
        exact += _blocks(picks[i : i + 10])
        time.sleep(1.0)
    b = np.array([r[0] for r in exact], dtype=np.int64)
    ts = np.array([r[1] for r in exact], dtype=np.int64)
    err = np.abs(clock.time_of(b) - ts)
    res = {
        "generatedAt": now_iso(),
        "samples": int(len(b)),
        "sampleStepBlocks": int(np.median(np.diff(clock.block))),
        "errorSec": {"p50": float(np.percentile(err, 50)), "p99": float(np.percentile(err, 99)), "max": int(err.max())},
        "shareWithin1s": float((err <= 1).mean()),
        # timestamps are whole seconds, so +-1 s is the floor any interpolation can reach; the gate asks for 99 % there
        "pass": bool((err <= 1).mean() >= 0.99),
    }
    write_json(OUT_DIR / "fables-clock-check.json", res)
    print(json.dumps(res["errorSec"]), f"within 1 s: {res['shareWithin1s']:.1%}", "PASS" if res["pass"] else "FAIL: rerun blocks with a smaller --step")


def _etherscan_key() -> str:
    key = os.environ.get("ETHERSCAN_API_KEY", "")
    env = LAB_DIR.parent / "contracts" / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("ETHERSCAN_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        sys.exit("ETHERSCAN_API_KEY is not set (env or contracts/.env)")
    return key


def _logs(topic0: str, from_block: int, to_block: int) -> list[dict]:
    key = _etherscan_key()
    rows: list[dict] = []
    start = from_block
    while start <= to_block:
        q = {
            "chainid": robin.CHAIN_ID,
            "module": "logs",
            "action": "getLogs",
            "address": robin.HOOK,
            "topic0": topic0,
            "topic0_1_opr": "and",
            "topic1": robin.POOL_ID,
            "fromBlock": start,
            "toBlock": to_block,
            "page": 1,
            "offset": 1000,
            "apikey": key,
        }
        doc = json.loads(_get(ETHERSCAN + "?" + urllib.parse.urlencode(q)))
        page = doc.get("result") or []
        if not isinstance(page, list):
            raise RuntimeError(f"Etherscan error: {doc.get('message')}")
        rows += page
        if len(page) < 1000:
            break
        nxt = int(page[-1]["blockNumber"], 16)  # resume at the last block; duplicates removed below
        start = nxt if nxt > start else start + 1
        time.sleep(0.25)
    seen, out = set(), []
    for r in rows:
        k = (r["transactionHash"], r.get("logIndex", "0x"))
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def cmd_logs(args) -> None:
    clock = robin.BlockClock.from_json(RAW / "blocks.json")
    last = int(clock.block[-1])
    for name, topic in (
        ("feepoked", fb.FEE_POKED_TOPIC),
        ("pokecleared", fb.POKE_CLEARED_TOPIC),
        ("poolconfigured", fb.POOL_CONFIGURED_TOPIC),
    ):
        path = RAW / f"{name}.json"
        if path.exists() and not args.refresh:
            print(f"{path} exists")
            continue
        rows = _logs(topic, robin.HOOK_DEPLOY_BLOCK, last)
        path.write_text(json.dumps(rows))
        print(f"wrote {path}: {len(rows)} logs")


def _days() -> list[str]:
    d0 = datetime.fromtimestamp(START - PAD_BEFORE, timezone.utc).date()
    d1 = datetime.fromtimestamp(END + PAD_AFTER, timezone.utc).date()
    out, d = [], d0
    while d <= d1:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def cmd_binance(args) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for day in _days():
        path = RAW / f"b1s_{day}.csv"
        if path.exists() and not args.refresh:
            continue
        url = f"https://data.binance.vision/data/spot/daily/klines/ETHUSDT/1s/ETHUSDT-1s-{day}.zip"
        z = zipfile.ZipFile(io.BytesIO(_get(url, timeout=300)))
        lines = z.read(z.namelist()[0]).decode().splitlines()
        rows = venue.parse_binance_rows(lines)
        path.write_text("".join(f"{t},{c}\n" for t, c in rows))
        print(f"wrote {path}: {len(rows)} seconds")


def cmd_usdt(args) -> None:
    path = RAW / "usdtusd_1m.json"
    if path.exists() and not args.refresh:
        print(f"{path} exists")
        return
    rows: list[tuple[int, float]] = []
    t = START - PAD_BEFORE
    while t < END + PAD_AFTER:
        t2 = min(t + 300 * 60, END + PAD_AFTER)
        q = {
            "granularity": 60,
            "start": datetime.fromtimestamp(t, timezone.utc).isoformat(),
            "end": datetime.fromtimestamp(t2, timezone.utc).isoformat(),
        }
        url = "https://api.exchange.coinbase.com/products/USDT-USD/candles?" + urllib.parse.urlencode(q)
        for c in json.loads(_get(url)):  # [time, low, high, open, close, volume], newest first
            rows.append((int(c[0]), float(c[4])))
        t = t2
        time.sleep(0.35)
    RAW.mkdir(parents=True, exist_ok=True)
    venue.save_minute_rows(path, rows)
    print(f"wrote {path}: {len(set(rows))} minutes")


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("blocks")
    b.add_argument("--step", type=int, default=600)
    b.add_argument("--batch", type=int, default=20)
    b.add_argument("--pause", type=float, default=1.0)
    for name in ("blocks", "check-clock", "logs", "binance", "usdt"):
        sp = b if name == "blocks" else sub.add_parser(name)
        sp.add_argument("--refresh", action="store_true")
    args = p.parse_args()
    {
        "blocks": cmd_blocks,
        "check-clock": cmd_check_clock,
        "logs": cmd_logs,
        "binance": cmd_binance,
        "usdt": cmd_usdt,
    }[args.cmd](args)


if __name__ == "__main__":
    main()
