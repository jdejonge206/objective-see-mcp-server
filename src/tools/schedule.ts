/**
 * Scheduler tools: install/remove launchd LaunchAgents that run snapshot
 * scanners on a recurring interval, appending JSON to a log directory.
 *
 * Only snapshot scanners are schedulable: the streaming monitors and the
 * daemon-style tools (RansomWhere, BlockBlock, ...) are continuous by design and
 * auto-start once installed, so "scheduling" them is not meaningful.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { APP_BY_KEY, SCHEDULABLE_KEYS, LAUNCHD_PREFIX } from "../constants.js";
import { resolveBinary, LAUNCH_AGENTS_DIR, SCAN_LOG_DIR } from "../config.js";
import { runCommand, shQuote, textResult, errorResult } from "../exec.js";

const scanKeyEnum = z.enum(SCHEDULABLE_KEYS as [string, ...string[]]);

function labelFor(tool: string, suffix?: string): string {
  const base = `${LAUNCHD_PREFIX}.${tool}`;
  return suffix ? `${base}.${suffix.replace(/[^A-Za-z0-9_.-]/g, "-")}` : `${base}.scan`;
}

function plistXml(label: string, programArgs: string[], interval: number, logFile: string, errFile: string): string {
  const args = programArgs.map((a) => `    <string>${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${errFile}</string>
</dict>
</plist>
`;
}

export function registerSchedule(server: McpServer): void {
  server.registerTool(
    "os_schedule_scan",
    {
      title: "Schedule a recurring snapshot scan",
      description:
        "Create (or replace) a launchd LaunchAgent that runs a snapshot scanner on a fixed interval and appends " +
        "its JSON output to a timestamped log. Use this to put KnockKnock / TaskExplorer / Netiquette on a " +
        `routine. Args: tool (one of: ${SCHEDULABLE_KEYS.join(", ")}); interval_seconds (300-604800, e.g. 86400 ` +
        "for daily); include_apple (bool, default false); label_suffix (optional, to run several schedules for " +
        "one tool). Returns { label, plist_path, log_file, interval_seconds, loaded }. Note: runs as your user; " +
        "the scanner's app must already have Full Disk Access for complete results.",
      inputSchema: {
        tool: scanKeyEnum.describe("Which snapshot scanner to schedule."),
        interval_seconds: z.number().int().min(300).max(604800).describe("Run interval in seconds (>=300)."),
        include_apple: z.boolean().default(false).describe("Pass the scanner's Apple-include flag."),
        label_suffix: z.string().max(40).optional().describe("Optional suffix to distinguish multiple schedules.")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tool, interval_seconds, include_apple, label_suffix }) => {
      const app = APP_BY_KEY[tool];
      const bin = resolveBinary(app);
      if (!bin) return errorResult(`${app.name} is not installed; cannot schedule it.`);

      mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
      mkdirSync(SCAN_LOG_DIR, { recursive: true });

      const label = labelFor(tool, label_suffix);
      const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
      const logFile = join(SCAN_LOG_DIR, `${label}.log`);
      const errFile = join(SCAN_LOG_DIR, `${label}.err.log`);

      // TaskExplorer's default '-scan' queries VirusTotal on every task, which stalls on the
      // public-API rate limit and would hang the scheduled run indefinitely. Use the same
      // '-explore -skipVT' enumeration the interactive tool defaults to.
      const scanArgs = tool === "taskexplorer" ? ["-explore", "-skipVT"] : [...(app.baseArgs ?? [])];
      if (include_apple && (tool === "knockknock" || tool === "taskexplorer")) scanArgs.push("-apple");
      // Wrap so each run is timestamped and appended.
      const inner =
        `printf '\\n===== %s =====\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; ` +
        `${shQuote(bin)} ${scanArgs.map(shQuote).join(" ")}`;
      const programArgs = ["/bin/sh", "-c", inner];

      // Replace any existing definition with the same label.
      if (existsSync(plistPath)) {
        await runCommand("/bin/launchctl", ["unload", plistPath], { timeoutMs: 10000 });
      }
      writeFileSync(plistPath, plistXml(label, programArgs, interval_seconds, logFile, errFile), "utf8");
      const load = await runCommand("/bin/launchctl", ["load", "-w", plistPath], { timeoutMs: 10000 });
      const loaded = load.code === 0;

      const out = {
        label,
        plist_path: plistPath,
        log_file: logFile,
        interval_seconds,
        loaded,
        launchctl_stderr: load.stderr.trim() || undefined
      };
      return textResult(
        `${loaded ? "Scheduled" : "Wrote plist but launchctl reported an issue for"} ${app.name}: every ` +
          `${interval_seconds}s -> ${logFile}\nLabel: ${label}` +
          (load.stderr.trim() ? `\nlaunchctl: ${load.stderr.trim()}` : ""),
        out
      );
    }
  );

  server.registerTool(
    "os_list_schedules",
    {
      title: "List scheduled scans",
      description:
        "List the recurring snapshot-scan LaunchAgents created by this server (label prefix " +
        `"${LAUNCHD_PREFIX}"). Read-only. No arguments. Returns { launch_agents_dir, schedules: [ { label, ` +
        "plist_path, loaded } ] }.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      if (!existsSync(LAUNCH_AGENTS_DIR))
        return textResult("No schedules found.", { launch_agents_dir: LAUNCH_AGENTS_DIR, schedules: [] });
      const list = await runCommand("/bin/launchctl", ["list"], { timeoutMs: 10000 });
      const schedules = readdirSync(LAUNCH_AGENTS_DIR)
        .filter((f) => f.startsWith(LAUNCHD_PREFIX) && f.endsWith(".plist"))
        .map((f) => {
          const label = f.replace(/\.plist$/, "");
          return { label, plist_path: join(LAUNCH_AGENTS_DIR, f), loaded: list.stdout.includes(label) };
        });
      const out = { launch_agents_dir: LAUNCH_AGENTS_DIR, schedules };
      return textResult(JSON.stringify(out, null, 2), out);
    }
  );

  server.registerTool(
    "os_unschedule_scan",
    {
      title: "Remove a scheduled scan",
      description:
        "Unload and delete a recurring snapshot-scan LaunchAgent previously created by os_schedule_scan. " +
        "Provide the exact label (from os_list_schedules). Arg: label. Returns { label, unloaded, removed }.",
      inputSchema: {
        label: z.string().min(1).describe(`Exact LaunchAgent label, e.g. "${LAUNCHD_PREFIX}.knockknock.scan".`)
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
    },
    async ({ label }) => {
      if (!label.startsWith(LAUNCHD_PREFIX))
        return errorResult(`Refusing to touch label "${label}" — only schedules created by this server (prefix "${LAUNCHD_PREFIX}") can be removed.`);
      const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
      if (!existsSync(plistPath)) return errorResult(`No schedule found with label "${label}".`);
      const unload = await runCommand("/bin/launchctl", ["unload", "-w", plistPath], { timeoutMs: 10000 });
      let removed = false;
      try { rmSync(plistPath); removed = true; } catch { /* ignore */ }
      const out = { label, unloaded: unload.code === 0, removed };
      return textResult(`Removed schedule ${label} (unloaded=${out.unloaded}, removed=${removed}).`, out);
    }
  );
}
