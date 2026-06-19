/**
 * Registry of Objective-See tools and shared constants.
 *
 * Capability tiers (verified by inspecting each binary's CLI):
 *   - "snapshot": one-shot scanners that print a JSON document to stdout.
 *   - "monitor":  stream JSON events; require root + an Endpoint Security grant.
 *   - "gui":      GUI / Finder-extension / background-daemon tools with no data
 *                 CLI. Integratable only via launch + install/uninstall control.
 */

export const CHARACTER_LIMIT = 25000;

export type ToolKind = "snapshot" | "monitor" | "gui";

export interface AppDef {
  /** Stable key used as the MCP tool argument value. */
  key: string;
  /** Human-readable name. */
  name: string;
  /** Candidate .app bundle names to look for in the apps directory. */
  bundleNames: string[];
  /** Executable name inside Contents/MacOS (for tools with a CLI). */
  binary?: string;
  kind: ToolKind;
  /** Base CLI args producing machine-readable JSON. */
  baseArgs?: string[];
  /** Monitors need root (sudo) to attach to the Endpoint Security subsystem. */
  needsRoot?: boolean;
  /** Snapshot scanners that make sense to run on a recurring schedule. */
  schedulable?: boolean;
  /** Wrapper installer bundle (X Installer.app) exposing -install/-uninstall. */
  installerBundle?: string;
  /** Short note surfaced in status output. */
  note?: string;
}

export const APPS: AppDef[] = [
  // ---- Snapshot scanners (run as user; richer with root) ----
  {
    key: "knockknock",
    name: "KnockKnock",
    bundleNames: ["KnockKnock.app"],
    binary: "KnockKnock",
    kind: "snapshot",
    baseArgs: ["-whosthere"],
    schedulable: true,
    note: "Persistence scanner: enumerates persistently installed software."
  },
  {
    key: "taskexplorer",
    name: "TaskExplorer",
    bundleNames: ["TaskExplorer.app"],
    binary: "TaskExplorer",
    kind: "snapshot",
    baseArgs: ["-scan"],
    schedulable: true,
    note: "Process explorer: tasks with hashes, code signatures, VT detections, dylibs, connections."
  },
  {
    key: "netiquette",
    name: "Netiquette",
    bundleNames: ["Netiquette.app"],
    binary: "Netiquette",
    kind: "snapshot",
    baseArgs: ["-list"],
    schedulable: true,
    note: "Network monitor: snapshot of current network connections."
  },

  // ---- Streaming monitors (root + Endpoint Security entitlement) ----
  {
    key: "filemonitor",
    name: "FileMonitor",
    bundleNames: ["FileMonitor.app"],
    binary: "FileMonitor",
    kind: "monitor",
    baseArgs: [],
    needsRoot: true,
    note: "Streams file I/O events (create/modify/delete/rename) as JSON."
  },
  {
    key: "processmonitor",
    name: "ProcessMonitor",
    bundleNames: ["ProcessMonitor.app"],
    binary: "ProcessMonitor",
    kind: "monitor",
    baseArgs: [],
    needsRoot: true,
    note: "Streams process events (exec/fork/exit) as JSON."
  },
  {
    key: "dnsmonitor",
    name: "DNSMonitor",
    bundleNames: ["DNSMonitor.app"],
    binary: "DNSMonitor",
    kind: "monitor",
    baseArgs: ["-json"],
    needsRoot: true,
    note: "Streams DNS request/response events as JSON."
  },

  // ---- GUI / installer / background-daemon tools (control only) ----
  {
    key: "blockblock",
    name: "BlockBlock",
    bundleNames: ["BlockBlock.app"],
    kind: "gui",
    installerBundle: "BlockBlock Installer.app",
    note: "Persistence monitor (background daemon)."
  },
  {
    key: "oversight",
    name: "OverSight",
    bundleNames: ["OverSight.app"],
    kind: "gui",
    installerBundle: "OverSight Installer.app",
    note: "Mic/webcam access monitor (background)."
  },
  {
    key: "donotdisturb",
    name: "DoNotDisturb",
    bundleNames: ["DoNotDisturb.app"],
    kind: "gui",
    installerBundle: "DoNotDisturb Installer.app",
    note: "Physical (lid-open) access monitor."
  },
  {
    key: "reikey",
    name: "ReiKey",
    bundleNames: ["ReiKey.app"],
    kind: "gui",
    installerBundle: "ReiKey Installer.app",
    note: "Keystroke-tap (keylogger) detector. No data CLI; launch/install only. Installs a login-item helper that runs at login."
  },
  {
    key: "ransomwhere",
    name: "RansomWhere",
    bundleNames: ["RansomWhere.app"],
    kind: "gui",
    installerBundle: "RansomWhere Installer.app",
    note: "Ransomware behavior monitor. No data CLI; runs as a persistent daemon once installed (auto-starts)."
  },
  {
    key: "kextviewr",
    name: "KextViewr",
    bundleNames: ["KextViewr.app"],
    kind: "gui",
    note: "Loaded kernel-extension viewer (GUI)."
  },
  {
    key: "whatsyoursign",
    name: "WhatsYourSign",
    bundleNames: ["WhatsYourSign.app"],
    kind: "gui",
    installerBundle: "WhatsYourSign Installer.app",
    note: "Finder extension showing code-signing info."
  },
  {
    key: "dhs",
    name: "DHS",
    bundleNames: ["DHS.app"],
    kind: "gui",
    note: "Dylib Hijack Scanner (GUI only; no command-line interface)."
  }
];

export const APP_BY_KEY: Record<string, AppDef> = Object.fromEntries(
  APPS.map((a) => [a.key, a])
);

export const SNAPSHOT_KEYS = APPS.filter((a) => a.kind === "snapshot").map((a) => a.key);
export const MONITOR_KEYS = APPS.filter((a) => a.kind === "monitor").map((a) => a.key);
export const SCHEDULABLE_KEYS = APPS.filter((a) => a.schedulable).map((a) => a.key);
export const INSTALLABLE_KEYS = APPS.filter((a) => a.installerBundle).map((a) => a.key);
export const ALL_KEYS = APPS.map((a) => a.key);

/** launchd label prefix for schedules this server creates. */
export const LAUNCHD_PREFIX = "com.objective-see-mcp";
