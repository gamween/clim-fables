import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exitCodeFor, FORWARDED_SIGNALS, forwardSignals, jobLabel, jobPathVar, LIVE_JOB_NAMES, liveJobSpec, parseLaunchctlPrint, plistFor, type JobPaths } from "../../src/live/lib/launchd";

const P: JobPaths = { bun: "/opt/homebrew/bin/bun", cre: "/Users/me/.cre/bin/cre", botsDir: "/Users/me/clim-fables/bots", home: "/Users/me" };

describe("launchd job specs", () => {
  test("six jobs, labelled fi.clim-fables.<name>", () => {
    expect(LIVE_JOB_NAMES).toEqual(["desk", "runner", "keeper", "arb", "noise", "outages"]);
    expect(jobLabel("runner")).toBe("fi.clim-fables.runner");
  });
  test("absolute bun and cre, absolute scripts, logs under bots/out/logs", () => {
    const desk = liveJobSpec("desk", P);
    expect(desk.programArguments).toEqual([
      "/opt/homebrew/bin/bun",
      "/Users/me/clim-fables/bots/src/live/desk-loop.ts",
      "--target",
      "rh-testnet-settings",
      "--cre-bin",
      "/Users/me/.cre/bin/cre",
    ]);
    expect(desk.workingDirectory).toBe("/Users/me/clim-fables/bots");
    expect(desk.stdoutPath).toBe("/Users/me/clim-fables/bots/out/logs/desk.log");
    expect(desk.stderrPath).toBe("/Users/me/clim-fables/bots/out/logs/desk.err.log");
    expect(liveJobSpec("outages", P).programArguments.slice(1)).toEqual(["/Users/me/clim-fables/bots/src/live/scripts/outages.ts", "--watch"]);
  });
  test("PATH: bun's and cre's folders first, no duplicates", () => {
    expect(jobPathVar(P)).toBe("/opt/homebrew/bin:/Users/me/.cre/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });
});

describe("plist", () => {
  const plist = plistFor(liveJobSpec("runner", P));
  test("keep-alive job with a 30 s throttle", () => {
    expect(plist).toContain("<key>Label</key>\n\t<string>fi.clim-fables.runner</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n\t<true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n\t<true/>");
    expect(plist).toContain("<key>ThrottleInterval</key>\n\t<integer>30</integer>");
    expect(plist).toContain("<string>/Users/me/clim-fables/bots/src/live/runner.ts</string>");
  });
  test("no secret: only HOME and PATH, and a key-like variable is refused", () => {
    expect(plist).not.toMatch(/KEY|RPC|SECRET|TOKEN/);
    const spec = liveJobSpec("runner", P);
    expect(() => plistFor({ ...spec, env: { ...spec.env, RUNNER_PRIVATE_KEY: "0x00" } })).toThrow(/must not be in a plist/);
  });
  test("relative paths are refused; XML is escaped", () => {
    const spec = liveJobSpec("arb", P);
    expect(() => plistFor({ ...spec, workingDirectory: "bots" })).toThrow(/absolute/);
    expect(() => plistFor({ ...spec, programArguments: ["bun", "src/live/arb.ts"] })).toThrow(/absolute/);
    expect(plistFor({ ...spec, workingDirectory: "/tmp/a&b" })).toContain("<string>/tmp/a&amp;b</string>");
  });
  test.skipIf(process.platform !== "darwin")("plutil accepts it", () => {
    const f = join(mkdtempSync(join(tmpdir(), "clim-plist-")), "job.plist");
    writeFileSync(f, plist);
    const r = spawnSync("plutil", ["-lint", f], { encoding: "utf8" });
    expect(r.stdout).toContain("OK");
  });
});

describe("launchctl print", () => {
  test("state, pid and last exit code of the top-level job", () => {
    const running = "gui/501/fi.clim-fables.runner = {\n\tactive count = 1\n\tstate = running\n\n\tprogram = /opt/homebrew/bin/bun\n\tpid = 4242\n\tlast exit code = (never exited)\n\tjob state = running\n}\n";
    expect(parseLaunchctlPrint(running)).toEqual({ state: "running", pid: 4242, lastExitCode: "(never exited)" });
    const waiting = "gui/501/fi.clim-fables.desk = {\n\tstate = not running\n\tlast exit code = 1\n\tjob state = exited\n}\n";
    expect(parseLaunchctlPrint(waiting)).toEqual({ state: "not running", pid: null, lastExitCode: "1" });
  });
});

describe("live:logs follows the logs in the foreground", () => {
  test("SIGINT, SIGTERM, SIGHUP and SIGALRM (perl's alarm) go to the child", () => {
    expect([...FORWARDED_SIGNALS]).toEqual(["SIGINT", "SIGTERM", "SIGHUP", "SIGALRM"]);
    const source = new EventEmitter();
    const sent: string[] = [];
    forwardSignals({ kill: (s: NodeJS.Signals) => sent.push(s) > 0 }, source);
    for (const s of ["SIGTERM", "SIGALRM", "SIGINT", "SIGHUP", "SIGUSR1"]) source.emit(s);
    expect(sent).toEqual(["SIGTERM", "SIGALRM", "SIGINT", "SIGHUP"]);
  });
  test("exits with the child's code, or 128 + the signal that ended it", () => {
    expect(exitCodeFor(0, null)).toBe(0);
    expect(exitCodeFor(1, null)).toBe(1);
    expect(exitCodeFor(null, "SIGTERM")).toBe(143);
    expect(exitCodeFor(null, "SIGALRM")).toBe(142);
    expect(exitCodeFor(null, "SIGINT")).toBe(130);
    expect(exitCodeFor(null, null)).toBe(1);
  });
  test.skipIf(process.platform === "win32")("killing the parent ends the child too (no orphan tail)", async () => {
    const lib = join(import.meta.dir, "..", "..", "src", "live", "lib", "launchd.ts");
    const code = `import { execForwarding } from ${JSON.stringify(lib)}; const c = execForwarding("sleep", ["30"], "ignore"); console.log(c.pid);`;
    for (const [signal, status] of [["SIGTERM", 143], ["SIGALRM", 142]] as const) {
      const parent = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
      const childPid = await new Promise<number>((resolve) => parent.stdout.once("data", (b: Buffer) => resolve(Number(b.toString().trim()))));
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      expect(alive(childPid)).toBe(true);
      const exited = new Promise<number | null>((resolve) => parent.once("exit", (c) => resolve(c)));
      parent.kill(signal);
      expect(await exited).toBe(status);
      expect(alive(childPid)).toBe(false);
    }
  });
});
