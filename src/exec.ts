/**
 * Shared process-execution and parsing helpers.
 */
import { execFile, spawn } from "node:child_process";
import { CHARACTER_LIMIT } from "./constants.js";
import { USE_SUDO } from "./config.js";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/** POSIX single-quote shell escaping. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** A standard MCP text result. */
export function textResult(text: string, structured?: Record<string, unknown>) {
  const t = text.length > CHARACTER_LIMIT
    ? text.slice(0, CHARACTER_LIMIT) +
      `\n\n...[truncated ${text.length - CHARACTER_LIMIT} chars; narrow the scope or use a filter]`
    : text;
  return structured
    ? { content: [{ type: "text" as const, text: t }], structuredContent: structured }
    : { content: [{ type: "text" as const, text: t }] };
}

/** An MCP error result with an actionable message. */
export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** Run a binary directly (non-streaming). Optionally via `sudo -n`. */
export function runCommand(
  file: string,
  args: string[],
  opts: { timeoutMs?: number; sudo?: boolean } = {}
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let cmd = file;
  let cmdArgs = args;
  if (opts.sudo && USE_SUDO) {
    cmd = "sudo";
    cmdArgs = ["-n", file, ...args];
  }
  return new Promise((resolve) => {
    execFile(
      cmd,
      cmdArgs,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number }) | null;
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          code: e && typeof e.code === "number" ? e.code : err ? 1 : 0,
          timedOut: !!(e && e.killed)
        });
      }
    );
  });
}

/**
 * Run a streaming monitor for `durationSec`, then stop it cleanly. The monitor
 * (and the kill that stops it) run under one shell so that, when elevated, the
 * kill is performed with the same privileges as the monitor.
 */
export function captureMonitor(
  binPath: string,
  args: string[],
  durationSec: number,
  sudo: boolean
): Promise<RunResult> {
  const inner =
    `${shQuote(binPath)} ${args.map(shQuote).join(" ")} & ` +
    `PID=$!; sleep ${durationSec}; ` +
    `kill -INT $PID 2>/dev/null; sleep 1; kill -TERM $PID 2>/dev/null; ` +
    `kill -KILL $PID 2>/dev/null; wait $PID 2>/dev/null; exit 0`;

  let cmd = "/bin/sh";
  let cmdArgs = ["-c", inner];
  if (sudo && USE_SUDO) {
    cmd = "sudo";
    cmdArgs = ["-n", "/bin/sh", "-c", inner];
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const hardTimer = setTimeout(() => {
      if (!settled) {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }, (durationSec + 15) * 1000);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      resolve({ stdout, stderr, code, timedOut: false });
    };
    child.on("error", (e) => finish((e as NodeJS.ErrnoException).errno ?? 1));
    child.on("close", (code) => finish(code));
  });
}

/** Parse a single JSON document, tolerating leading banner text. */
export function parseJsonLoose(raw: string): { value: unknown | null; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: "empty output" };
  try {
    return { value: JSON.parse(trimmed) };
  } catch { /* fall through */ }
  const start = trimmed.search(/[[{]/);
  if (start >= 0) {
    const slice = trimmed.slice(start);
    try {
      return { value: JSON.parse(slice) };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }
  return { value: null, error: "no JSON found in output" };
}

/** Parse newline-delimited JSON event stream; returns parsed events + leftovers. */
export function parseJsonLines(raw: string): { events: unknown[]; nonJson: string[] } {
  const events: unknown[] = [];
  const nonJson: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      nonJson.push(t);
    }
  }
  return { events, nonJson };
}

/** Detect the classic non-interactive sudo failure so we can advise the user. */
export function sudoBlocked(stderr: string): boolean {
  return /a (password|terminal) is required|sudo: a password|not allowed|may not run sudo/i.test(stderr);
}
