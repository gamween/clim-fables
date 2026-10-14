// Installs, removes and tails the live stack's launchd LaunchAgents (fi.clim-fables.<name>) on the maintainer's Mac.
// install: resolves bun and cre on PATH, writes ~/Library/LaunchAgents/fi.clim-fables.<name>.plist (no secret in it) and
//          bootstraps it into gui/<uid> (a job already loaded is booted out first, so install also reloads).
// uninstall: boots the jobs out and removes their plists (they then stay stopped after a reboot).
// logs: tails bots/out/logs/<name>.log and .err.log (a signal that ends this process ends the tail too).
// print: prints the plists without writing or loading anything.
// Health: bun run live:status.
// Usage: bun src/live/scripts/launchd.ts <install|uninstall|logs|print> [name ...]   (names: desk runner keeper arb noise outages)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/deployments";
import { execForwarding, guiDomain, isLiveJobName, jobLabel, jobState, LIVE_JOB_NAMES, liveJobSpec, logPaths, plistFor, type JobPaths, type LiveJobName } from "../lib/launchd";

const BOTS_DIR = join(REPO_ROOT, "bots");
const AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const [command, ...rest] = process.argv.slice(2);
const names: LiveJobName[] = rest.length === 0 ? [...LIVE_JOB_NAMES] : rest.map((n) => {
  if (!isLiveJobName(n)) throw new Error(`unknown job ${n} (one of ${LIVE_JOB_NAMES.join(", ")})`);
  return n;
});
const plistPath = (name: LiveJobName) => join(AGENTS_DIR, `${jobLabel(name)}.plist`);

function launchctl(args: string[], allowFail = false): void {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  if (r.status !== 0 && !allowFail) throw new Error(`launchctl ${args.join(" ")} failed (${r.status}): ${(r.stderr || r.stdout).trim()}`);
}

/** bootout returns before launchd has removed the job; bootstrap fails while it is still there. */
function bootout(name: LiveJobName): void {
  launchctl(["bootout", `${guiDomain()}/${jobLabel(name)}`], true);
  for (let i = 0; i < 40 && jobState(name) !== null; i++) Bun.sleepSync(250);
  if (jobState(name) !== null) throw new Error(`${jobLabel(name)} is still loaded 10 s after bootout`);
}

/** bun and cre as found on PATH now (stable Homebrew links, not versioned Cellar paths). */
function resolvePaths(): JobPaths {
  const bun = Bun.which("bun") ?? process.execPath;
  const cre = Bun.which("cre");
  if (!cre) throw new Error("the cre CLI is not on PATH: install it (plan 03 Task 16) and rerun");
  return { bun, cre, botsDir: BOTS_DIR, home: homedir() };
}

function install(): void {
  if (process.platform !== "darwin") throw new Error("launchd jobs need macOS");
  const paths = resolvePaths();
  const { bun, cre } = paths;
  mkdirSync(AGENTS_DIR, { recursive: true });
  mkdirSync(join(BOTS_DIR, "out", "logs"), { recursive: true });
  console.log(`bun ${bun}\ncre ${cre}\nrepo ${REPO_ROOT}`);
  for (const name of names) {
    const spec = liveJobSpec(name, paths);
    writeFileSync(plistPath(name), plistFor(spec));
    bootout(name);
    launchctl(["enable", `${guiDomain()}/${spec.label}`]);
    launchctl(["bootstrap", guiDomain(), plistPath(name)]);
    const st = jobState(name);
    console.log(`${spec.label}: ${st?.state ?? "not loaded"}${st?.pid ? ` (pid ${st.pid})` : ""}, logs ${spec.stdoutPath}`);
  }
}

function uninstall(): void {
  for (const name of names) {
    bootout(name);
    if (existsSync(plistPath(name))) rmSync(plistPath(name));
    console.log(`${jobLabel(name)}: removed`);
  }
}

function logs(): void {
  const files = names.flatMap((n) => {
    const p = logPaths(n, BOTS_DIR);
    return [p.stdout, p.stderr];
  });
  // tail in the foreground: Ctrl+C, a kill or perl's alarm reach it through this process, never orphaning it
  execForwarding("tail", ["-n", "20", "-F", ...files]);
}

function print(): void {
  const paths = resolvePaths();
  for (const name of names) process.stdout.write(plistFor(liveJobSpec(name, paths)));
}

if (command === "install") install();
else if (command === "uninstall") uninstall();
else if (command === "logs") logs();
else if (command === "print") print();
else throw new Error("usage: bun src/live/scripts/launchd.ts <install|uninstall|logs|print> [name ...]");
