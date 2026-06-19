/**
 * Streaming monitor tools: FileMonitor, ProcessMonitor, DNSMonitor.
 * These attach to Apple's Endpoint Security subsystem, so they require root and
 * a one-time approval. We run them for a bounded capture window and return the
 * collected JSON events.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_BY_KEY } from "../constants.js";
import { resolveBinary, USE_SUDO } from "../config.js";
import { captureMonitor, parseJsonLines, textResult, errorResult, sudoBlocked } from "../exec.js";

const MAX_EVENTS_RETURNED = 2000;

async function runMonitor(
  key: string,
  extraArgs: string[],
  durationSec: number,
  useSudo: boolean
) {
  const app = APP_BY_KEY[key];
  const bin = resolveBinary(app);
  if (!bin)
    return errorResult(
      `${app.name} is not installed in the apps directory. Move ${app.name}.app into /Applications ` +
        `(or set OS_APPS_DIR), then retry.`
    );

  const args = [...(app.baseArgs ?? []), ...extraArgs];
  const res = await captureMonitor(bin, args, durationSec, useSudo);

  if (useSudo && USE_SUDO && sudoBlocked(res.stderr))
    return errorResult(
      `${app.name} requires root and passwordless sudo isn't configured. Options: (1) run the MCP ` +
        `server as root and set OS_USE_SUDO=false; (2) add a sudoers rule for ${bin} (see README); ` +
        `(3) start the monitor manually.`
    );

  const { events, nonJson } = parseJsonLines(res.stdout);

  if (events.length === 0) {
    const hint =
      nonJson.length > 0
        ? `Captured ${nonJson.length} non-JSON line(s). First: ${nonJson[0]?.slice(0, 300)}`
        : res.stderr
          ? `stderr: ${res.stderr.slice(0, 600)}`
          : "No output. Likely missing root or Endpoint Security approval, or no events occurred in the window.";
    return errorResult(`${app.name} captured no events. ${hint}`);
  }

  const truncated = events.length > MAX_EVENTS_RETURNED;
  const returned = truncated ? events.slice(0, MAX_EVENTS_RETURNED) : events;
  const summary = {
    tool: app.name,
    duration_seconds: durationSec,
    total_events: events.length,
    returned_events: returned.length,
    truncated,
    events: returned
  };
  return textResult(JSON.stringify(summary, null, 2), summary);
}

export function registerMonitors(server: McpServer): void {
  const baseInput = {
    duration_seconds: z
      .number()
      .int()
      .min(1)
      .max(120)
      .default(10)
      .describe("How long to capture the event stream before stopping."),
    skip_apple: z.boolean().default(false).describe("Exclude Apple-signed processes from events."),
    use_sudo: z.boolean().default(true).describe("Run via sudo -n (required unless server runs as root).")
  };

  server.registerTool(
    "filemonitor_capture",
    {
      title: "FileMonitor file-event capture",
      description:
        "Capture macOS file I/O events (create/modify/delete/rename, with the responsible process) for a " +
        "bounded window using FileMonitor, returning the JSON events. Requires root (sudo) and a one-time " +
        "Endpoint Security/Full Disk Access approval for FileMonitor. Args: duration_seconds (1-120, default " +
        "10); filter (optional process name/path substring to limit events); skip_apple (bool); use_sudo " +
        "(bool, default true). Returns { tool, total_events, returned_events, truncated, events }.",
      inputSchema: {
        ...baseInput,
        filter: z.string().max(200).optional().describe("Only include events for this process name/path substring.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ duration_seconds, skip_apple, use_sudo, filter }) => {
      const extra: string[] = [];
      if (filter) extra.push("-filter", filter);
      if (skip_apple) extra.push("-skipApple");
      return runMonitor("filemonitor", extra, duration_seconds, use_sudo);
    }
  );

  server.registerTool(
    "processmonitor_capture",
    {
      title: "ProcessMonitor process-event capture",
      description:
        "Capture macOS process events (exec/fork/exit, with arguments, code-signing info, and the " +
        "responsible/parent process) for a bounded window using ProcessMonitor, returning JSON events. " +
        "Requires root (sudo) and Endpoint Security approval. Args: duration_seconds (1-120, default 10); " +
        "filter (optional process name/path substring); skip_apple (bool); use_sudo (bool, default true). " +
        "Returns { tool, total_events, returned_events, truncated, events }.",
      inputSchema: {
        ...baseInput,
        filter: z.string().max(200).optional().describe("Only include events for this process name/path substring.")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ duration_seconds, skip_apple, use_sudo, filter }) => {
      const extra: string[] = [];
      if (filter) extra.push("-filter", filter);
      if (skip_apple) extra.push("-skipApple");
      return runMonitor("processmonitor", extra, duration_seconds, use_sudo);
    }
  );

  server.registerTool(
    "dnsmonitor_capture",
    {
      title: "DNSMonitor DNS-event capture",
      description:
        "Capture DNS request/response events (queried domains and resolved answers, with the responsible " +
        "process where available) for a bounded window using DNSMonitor, returning JSON events. Requires " +
        "root (sudo) and a network-extension approval. Args: duration_seconds (1-120, default 10); use_sudo " +
        "(bool, default true). Returns { tool, total_events, returned_events, truncated, events }.",
      inputSchema: {
        duration_seconds: baseInput.duration_seconds,
        use_sudo: baseInput.use_sudo
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ duration_seconds, use_sudo }) => runMonitor("dnsmonitor", [], duration_seconds, use_sudo)
  );
}
