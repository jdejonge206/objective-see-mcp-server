#!/usr/bin/env node
/**
 * objective-see-mcp-server
 *
 * An MCP server wrapping Patrick Wardle's Objective-See macOS security tools.
 *
 *   Snapshot scanners : knockknock_scan, taskexplorer_scan, netiquette_list
 *   Streaming monitors: filemonitor_capture, processmonitor_capture, dnsmonitor_capture
 *   Control           : os_status, os_launch_tool, os_install_tool, os_uninstall_tool
 *   Scheduling        : os_schedule_scan, os_list_schedules, os_unschedule_scan
 *
 * Transport: stdio (local). Configuration via environment variables — see README.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerScanners } from "./tools/scanners.js";
import { registerMonitors } from "./tools/monitors.js";
import { registerControl } from "./tools/control.js";
import { registerSchedule } from "./tools/schedule.js";
import { APPS_DIR, INSTALLERS_DIR, USE_SUDO } from "./config.js";

function printHelp(): void {
  process.stdout.write(
    [
      "objective-see-mcp-server",
      "",
      "An MCP (stdio) server exposing Objective-See macOS security tools.",
      "",
      "Tools:",
      "  knockknock_scan, taskexplorer_scan, netiquette_list   (snapshot scanners)",
      "  filemonitor_capture, processmonitor_capture, dnsmonitor_capture  (monitors, need root)",
      "  os_status, os_launch_tool, os_install_tool, os_uninstall_tool    (control)",
      "  os_schedule_scan, os_list_schedules, os_unschedule_scan          (launchd scheduling)",
      "",
      "Environment:",
      "  OS_APPS_DIR         apps directory (default /Applications)",
      "  OS_INSTALLERS_DIR   directory holding '<Tool> Installer.app' (default = OS_APPS_DIR)",
      "  OS_USE_SUDO         'false' if the server already runs as root (default true)",
      "  OS_LAUNCH_AGENTS_DIR, OS_SCAN_LOG_DIR  override scheduling paths",
      ""
    ].join("\n")
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const server = new McpServer({ name: "objective-see-mcp-server", version: "1.0.0" });

  registerScanners(server);
  registerMonitors(server);
  registerControl(server);
  registerSchedule(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Diagnostics go to stderr so they don't corrupt the stdio JSON-RPC stream.
  console.error(
    `objective-see-mcp-server ready (apps=${APPS_DIR}, installers=${INSTALLERS_DIR}, sudo=${USE_SUDO}).`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
