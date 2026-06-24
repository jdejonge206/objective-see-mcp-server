/**
 * Snapshot scanner tools: KnockKnock, TaskExplorer, Netiquette.
 * Each shells out once, parses the JSON document, and returns it.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_BY_KEY } from "../constants.js";
import { resolveBinary } from "../config.js";
import { runCommand, parseJsonLoose, textResult, errorResult, sudoBlocked } from "../exec.js";

const notInstalled = (name: string) =>
  errorResult(
    `${name} is not installed in the apps directory. Move ${name}.app into /Applications ` +
      `(or set OS_APPS_DIR), then retry. Use os_status to see what's detected.`
  );

async function runScanner(
  key: string,
  extraArgs: string[],
  useSudo: boolean,
  timeoutSec: number,
  baseOverride?: string[]
) {
  const app = APP_BY_KEY[key];
  const bin = resolveBinary(app);
  if (!bin) return notInstalled(app.name);

  const args = [...(baseOverride ?? app.baseArgs ?? []), ...extraArgs];
  const res = await runCommand(bin, args, { sudo: useSudo, timeoutMs: timeoutSec * 1000 });

  if (res.timedOut) return errorResult(`${app.name} timed out after ${timeoutSec}s. Try a larger timeout_seconds.`);
  if (useSudo && sudoBlocked(res.stderr))
    return errorResult(
      `${app.name} needs elevated privileges but passwordless sudo isn't available. ` +
        `Retry with use_sudo=false, or configure sudoers (see README).`
    );

  const parsed = parseJsonLoose(res.stdout);
  if (parsed.value === null) {
    return errorResult(
      `${app.name} produced no parseable JSON (${parsed.error}). ` +
        `stderr: ${res.stderr.slice(0, 600) || "(none)"}. ` +
        `This usually means Full Disk Access has not been granted to ${app.name}.`
    );
  }
  return textResult(JSON.stringify(parsed.value, null, 2), { tool: app.name, result: parsed.value });
}

export function registerScanners(server: McpServer): void {
  server.registerTool(
    "knockknock_scan",
    {
      title: "KnockKnock persistence scan",
      description:
        "Run a one-shot KnockKnock scan that enumerates persistently installed software on macOS " +
        "(launch agents/daemons, login items, kernel extensions, browser extensions, cron jobs, etc.). " +
        "Returns KnockKnock's JSON report. Args: include_apple (bool, default false) to include items " +
        "signed by Apple; use_sudo (bool, default false) for a more complete scan; timeout_seconds (10-600). " +
        "Read-only. Returns { tool, result } where result is the parsed JSON report.",
      inputSchema: {
        include_apple: z.boolean().default(false).describe("Include Apple-signed items (noisier)."),
        use_sudo: z.boolean().default(false).describe("Run via sudo -n for a fuller scan."),
        timeout_seconds: z.number().int().min(10).max(600).default(180).describe("Max seconds to wait.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ include_apple, use_sudo, timeout_seconds }) =>
      runScanner("knockknock", include_apple ? ["-apple"] : [], use_sudo, timeout_seconds)
  );

  server.registerTool(
    "taskexplorer_scan",
    {
      title: "TaskExplorer process scan",
      description:
        "Run TaskExplorer to enumerate running tasks with rich metadata: path, pid, command line, hashes, " +
        "code signatures, VirusTotal detection ratios, loaded dylibs, open files, and network connections. " +
        "Args: pid (optional, scan a single process); include_apple (bool, default false); skip_vt (bool, " +
        "default true — skip VirusTotal lookups; querying VT on every task stalls on the public-API rate " +
        "limit, so this is on by default and runs via '-explore'); use_sudo (bool, default false, " +
        "recommended/required — TaskExplorer needs root for a full scan); timeout_seconds (10-600). " +
        "Read-only. Returns { tool, result } with the parsed JSON.",
      inputSchema: {
        pid: z.number().int().min(0).optional().describe("Limit the scan to a single process id."),
        include_apple: z.boolean().default(false).describe("Include Apple-signed processes."),
        skip_vt: z
          .boolean()
          .default(true)
          .describe(
            "Skip VirusTotal lookups (uses '-explore -skipVT'). Strongly recommended: VT queries on every " +
              "task stall on the public-API rate limit and will time out. Set false only for a small/single-pid scan."
          ),
        use_sudo: z.boolean().default(false).describe("Run via sudo -n; required for a full scan (TaskExplorer needs root)."),
        timeout_seconds: z.number().int().min(10).max(600).default(240).describe("Max seconds to wait.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ pid, include_apple, skip_vt, use_sudo, timeout_seconds }) => {
      const extra: string[] = [];
      if (typeof pid === "number") extra.push("-pid", String(pid));
      if (include_apple) extra.push("-apple");
      // VirusTotal querying on a full task list crawls against the public-API rate
      // limit; when skipping it we use '-explore' (full enumeration) + '-skipVT',
      // the combination verified to complete in seconds. Otherwise keep '-scan'.
      const baseOverride = skip_vt ? ["-explore", "-skipVT"] : undefined;
      return runScanner("taskexplorer", extra, use_sudo, timeout_seconds, baseOverride);
    }
  );

  server.registerTool(
    "netiquette_list",
    {
      title: "Netiquette network connection snapshot",
      description:
        "Run Netiquette to capture a snapshot of current network connections (process, local/remote " +
        "endpoints, protocol, state). Args: skip_apple (bool, default false) to omit Apple processes; " +
        "use_sudo (bool, default false); timeout_seconds (10-600). Read-only. Returns { tool, result }.",
      inputSchema: {
        skip_apple: z.boolean().default(false).describe("Exclude Apple-signed processes."),
        use_sudo: z.boolean().default(false).describe("Run via sudo -n."),
        timeout_seconds: z.number().int().min(10).max(600).default(120).describe("Max seconds to wait.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ skip_apple, use_sudo, timeout_seconds }) =>
      runScanner("netiquette", skip_apple ? ["-skipApple"] : [], use_sudo, timeout_seconds)
  );
}
