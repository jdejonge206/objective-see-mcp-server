/**
 * Control tools: launch / install / uninstall / status.
 *
 * These cover every Objective-See tool — including the GUI-only and
 * background-daemon ones (ReiKey, RansomWhere, BlockBlock, OverSight,
 * DoNotDisturb, KextViewr, WhatsYourSign, DHS) that have no data CLI. They can
 * still be launched, installed, and uninstalled programmatically.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APPS, APP_BY_KEY, ALL_KEYS, INSTALLABLE_KEYS } from "../constants.js";
import { resolveBundle, resolveInstaller } from "../config.js";
import { runCommand, textResult, errorResult, sudoBlocked } from "../exec.js";

const toolKeyEnum = z.enum(ALL_KEYS as [string, ...string[]]);
const installKeyEnum = z.enum(INSTALLABLE_KEYS as [string, ...string[]]);

async function isRunning(binaryOrName: string): Promise<boolean> {
  const res = await runCommand("/usr/bin/pgrep", ["-x", binaryOrName.slice(0, 15)], { timeoutMs: 5000 });
  return res.stdout.trim().length > 0;
}

export function registerControl(server: McpServer): void {
  server.registerTool(
    "os_status",
    {
      title: "Objective-See tools status",
      description:
        "Report every Objective-See tool this server knows about: its capability tier (snapshot/monitor/gui), " +
        "whether the .app is installed in the apps directory, whether an installer is present, and whether the " +
        "process currently appears to be running. Read-only. No arguments. Returns { apps_dir, installers_dir, " +
        "tools: [ { key, name, kind, installed, running, installer_available, note } ] }.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async () => {
      const { APPS_DIR, INSTALLERS_DIR } = await import("../config.js");
      const tools = [];
      for (const app of APPS) {
        const bundle = resolveBundle(app);
        const running = app.binary && bundle ? await isRunning(app.binary) : false;
        tools.push({
          key: app.key,
          name: app.name,
          kind: app.kind,
          installed: !!bundle,
          running,
          installer_available: !!resolveInstaller(app),
          note: app.note ?? ""
        });
      }
      const out = { apps_dir: APPS_DIR, installers_dir: INSTALLERS_DIR, tools };
      return textResult(JSON.stringify(out, null, 2), out);
    }
  );

  server.registerTool(
    "os_launch_tool",
    {
      title: "Launch an Objective-See tool",
      description:
        "Open an installed Objective-See app via `open`. Works for any tool with a resolvable .app bundle, " +
        "including GUI-only ones (ReiKey, RansomWhere, KextViewr, DHS, WhatsYourSign, BlockBlock, OverSight, " +
        `DoNotDisturb). Arg: tool (one of: ${ALL_KEYS.join(", ")}). If the app isn't installed, returns an ` +
        "actionable error suggesting os_install_tool. Returns { tool, launched, bundle }.",
      inputSchema: { tool: toolKeyEnum.describe("Which tool to launch.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async ({ tool }) => {
      const app = APP_BY_KEY[tool];
      const bundle = resolveBundle(app);
      if (!bundle)
        return errorResult(
          `${app.name} is not installed. ${app.installerBundle ? `Run os_install_tool with tool="${tool}" first, or ` : ""}` +
            `move ${app.name}.app into the apps directory.`
        );
      const res = await runCommand("/usr/bin/open", [bundle], { timeoutMs: 15000 });
      if (res.code !== 0)
        return errorResult(`Failed to launch ${app.name}: ${res.stderr.trim() || "open exited " + res.code}`);
      const out = { tool, launched: true, bundle };
      return textResult(`Launched ${app.name} (${bundle}).`, out);
    }
  );

  server.registerTool(
    "os_install_tool",
    {
      title: "Install an Objective-See tool",
      description:
        "Run a tool's installer with -install. Installs the app and any privileged helper/daemon/login-item, " +
        "so it typically needs root (sudo -n) and may surface a system approval prompt. Applicable to the " +
        `installer-based tools: ${INSTALLABLE_KEYS.join(", ")}. Args: tool; use_sudo (bool, default true). ` +
        "This modifies the system. Returns { tool, action: 'install', exit_code, stdout, stderr }.",
      inputSchema: {
        tool: installKeyEnum.describe("Which installer-based tool to install."),
        use_sudo: z.boolean().default(true).describe("Run the installer via sudo -n.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ tool, use_sudo }) => runInstaller(tool, "-install", use_sudo)
  );

  server.registerTool(
    "os_uninstall_tool",
    {
      title: "Uninstall an Objective-See tool",
      description:
        "Run a tool's installer with -uninstall to remove the app and its helper/daemon/login-item. Usually " +
        `needs root (sudo -n). Applicable to: ${INSTALLABLE_KEYS.join(", ")}. Args: tool; use_sudo (bool, ` +
        "default true). This modifies the system. Returns { tool, action: 'uninstall', exit_code, stdout, stderr }.",
      inputSchema: {
        tool: installKeyEnum.describe("Which installer-based tool to uninstall."),
        use_sudo: z.boolean().default(true).describe("Run the installer via sudo -n.")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    async ({ tool, use_sudo }) => runInstaller(tool, "-uninstall", use_sudo)
  );
}

async function runInstaller(tool: string, flag: "-install" | "-uninstall", useSudo: boolean) {
  const app = APP_BY_KEY[tool];
  const installer = resolveInstaller(app);
  if (!installer)
    return errorResult(
      `No installer found for ${app.name}. Expected "${app.installerBundle}" in the installers directory ` +
        `(set OS_INSTALLERS_DIR to where you keep the installers).`
    );
  const res = await runCommand(installer.binary, [flag], { sudo: useSudo, timeoutMs: 120000 });
  if (useSudo && sudoBlocked(res.stderr))
    return errorResult(
      `${app.name} ${flag} needs root but passwordless sudo isn't configured. Run with elevated privileges, ` +
        `add a sudoers rule for ${installer.binary}, or run the installer manually.`
    );
  const action = flag === "-install" ? "install" : "uninstall";
  const out = { tool, action, exit_code: res.code, stdout: res.stdout.trim(), stderr: res.stderr.trim() };
  const ok = res.code === 0;
  return textResult(
    `${ok ? "Completed" : "Attempted"} ${action} of ${app.name} (exit ${res.code}).` +
      (res.stderr.trim() ? `\nstderr: ${res.stderr.trim()}` : ""),
    out
  );
}
