// launchd LaunchAgents of the live stack (one per long-running process), on the maintainer's Mac. The plist generator
// and the `launchctl print` parser are pure; jobState() and guiDomain() are the thin system calls. Plists hold no secret:
// each process reads bots/.env (Bun, from its WorkingDirectory bots/) or cre/.env (the CRE CLI) as when started by hand.
// RunAtLoad and KeepAlive bring every job back after a reboot (the plists stay in ~/Library/LaunchAgents) and after a
// crash (no sooner than ThrottleInterval after its last start). Nothing here keeps the Mac awake: sleep is the
// maintainer's (his Pauline app), and outages are recorded (scripts/outages.ts), not prevented.
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";

export const LABEL_PREFIX = "fi.clim-fables.";
export const THROTTLE_SEC = 30;
export const LIVE_JOB_NAMES = ["desk", "runner", "keeper", "arb", "noise", "outages"] as const;
export type LiveJobName = (typeof LIVE_JOB_NAMES)[number];

/** Absolute paths resolved at install time. */
export type JobPaths = { bun: string; cre: string; botsDir: string; home: string };
export type JobSpec = {
  label: string;
  programArguments: string[];
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  env: Record<string, string>;
};

/** The only variables a plist may carry; anything else (a key, an RPC URL) stays in the .env files. */
export const PLIST_ENV_ALLOWED = ["HOME", "PATH"] as const;
const SYSTEM_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function jobLabel(name: LiveJobName): string {
  return `${LABEL_PREFIX}${name}`;
}

export function isLiveJobName(s: string): s is LiveJobName {
  return (LIVE_JOB_NAMES as readonly string[]).includes(s);
}

/** PATH for the jobs: bun's and cre's folders first (cre workflow build runs bun), then the system folders. */
export function jobPathVar(p: JobPaths): string {
  return [...new Set([dirname(p.bun), dirname(p.cre), ...SYSTEM_PATH])].join(":");
}

export function jobArgs(name: LiveJobName, p: JobPaths): string[] {
  const src = (f: string) => join(p.botsDir, "src", "live", f);
  switch (name) {
    case "desk":
      return [p.bun, src("desk-loop.ts"), "--target", "rh-testnet-settings", "--cre-bin", p.cre];
    case "runner":
      return [p.bun, src("runner.ts")];
    case "keeper":
      return [p.bun, src("keeper.ts")];
    case "arb":
      return [p.bun, src("arb.ts")];
    case "noise":
      return [p.bun, src("noise.ts")];
    case "outages":
      return [p.bun, src("scripts/outages.ts"), "--watch"];
  }
}

export function logPaths(name: LiveJobName, botsDir: string): { stdout: string; stderr: string } {
  const dir = join(botsDir, "out", "logs");
  return { stdout: join(dir, `${name}.log`), stderr: join(dir, `${name}.err.log`) };
}

export function liveJobSpec(name: LiveJobName, p: JobPaths): JobSpec {
  const logs = logPaths(name, p.botsDir);
  return {
    label: jobLabel(name),
    programArguments: jobArgs(name, p),
    workingDirectory: p.botsDir,
    stdoutPath: logs.stdout,
    stderrPath: logs.stderr,
    env: { HOME: p.home, PATH: jobPathVar(p) },
  };
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The plist of one job. Throws on a relative path or an environment variable outside PLIST_ENV_ALLOWED. */
export function plistFor(spec: JobSpec): string {
  if (!spec.label.startsWith(LABEL_PREFIX)) throw new Error(`label must start with ${LABEL_PREFIX}: ${spec.label}`);
  const [program] = spec.programArguments;
  for (const [what, path] of [
    ["program", program ?? ""],
    ["WorkingDirectory", spec.workingDirectory],
    ["StandardOutPath", spec.stdoutPath],
    ["StandardErrorPath", spec.stderrPath],
  ] as const) {
    if (!isAbsolute(path)) throw new Error(`${what} must be an absolute path, got "${path}"`);
  }
  for (const k of Object.keys(spec.env)) {
    if (!(PLIST_ENV_ALLOWED as readonly string[]).includes(k)) throw new Error(`${k} must not be in a plist (secrets and settings stay in the .env files)`);
  }
  const str = (s: string) => `<string>${xml(s)}</string>`;
  const env = Object.keys(spec.env)
    .sort()
    .map((k) => `\t\t<key>${xml(k)}</key>\n\t\t${str(spec.env[k] ?? "")}`)
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `\t<key>Label</key>\n\t${str(spec.label)}`,
    `\t<key>ProgramArguments</key>\n\t<array>\n${spec.programArguments.map((a) => `\t\t${str(a)}`).join("\n")}\n\t</array>`,
    `\t<key>WorkingDirectory</key>\n\t${str(spec.workingDirectory)}`,
    `\t<key>EnvironmentVariables</key>\n\t<dict>\n${env}\n\t</dict>`,
    "\t<key>RunAtLoad</key>\n\t<true/>",
    "\t<key>KeepAlive</key>\n\t<true/>",
    `\t<key>ThrottleInterval</key>\n\t<integer>${THROTTLE_SEC}</integer>`,
    `\t<key>StandardOutPath</key>\n\t${str(spec.stdoutPath)}`,
    `\t<key>StandardErrorPath</key>\n\t${str(spec.stderrPath)}`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export type JobState = { state: string | null; pid: number | null; lastExitCode: string | null };

/** The top-level state, pid and last exit code from `launchctl print gui/<uid>/<label>`. */
export function parseLaunchctlPrint(text: string): JobState {
  // top-level fields are indented by one tab; nested blocks by two ("job state" is another field)
  const field = (name: string) => new RegExp(`^\\t${name} = (.+)$`, "m").exec(text)?.[1]?.trim() ?? null;
  const pid = field("pid");
  return { state: field("state"), pid: pid !== null && /^\d+$/.test(pid) ? Number(pid) : null, lastExitCode: field("last exit code") };
}

export function guiDomain(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("launchd jobs need macOS (no uid)");
  return `gui/${uid}`;
}

/** The job's state, or null when it is not loaded. */
export function jobState(name: LiveJobName): JobState | null {
  const r = spawnSync("launchctl", ["print", `${guiDomain()}/${jobLabel(name)}`], { encoding: "utf8" });
  return r.status === 0 ? parseLaunchctlPrint(r.stdout) : null;
}
