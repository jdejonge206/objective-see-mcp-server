/**
 * Environment-driven configuration and filesystem resolution for app bundles.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppDef } from "./constants.js";

/** Directory where the standalone Objective-See .app bundles are installed. */
export const APPS_DIR = process.env.OS_APPS_DIR || "/Applications";

/**
 * Directory containing the "<Tool> Installer.app" wrappers. Defaults to APPS_DIR;
 * point OS_INSTALLERS_DIR at your downloads folder if you keep installers there.
 */
export const INSTALLERS_DIR = process.env.OS_INSTALLERS_DIR || APPS_DIR;

/** Whether to prefix privileged commands with `sudo -n`. Set OS_USE_SUDO=false if the server already runs as root. */
export const USE_SUDO = (process.env.OS_USE_SUDO ?? "true").toLowerCase() !== "false";

/** Where scheduled-scan LaunchAgent plists and logs are written. */
export const LAUNCH_AGENTS_DIR =
  process.env.OS_LAUNCH_AGENTS_DIR || join(homedir(), "Library", "LaunchAgents");
export const SCAN_LOG_DIR =
  process.env.OS_SCAN_LOG_DIR || join(homedir(), "Library", "Logs", "objective-see-mcp");

/** Resolve the installed .app bundle path, or null if not found. */
export function resolveBundle(app: AppDef): string | null {
  for (const name of app.bundleNames) {
    const p = join(APPS_DIR, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Resolve the executable inside an app bundle, or null. */
export function resolveBinary(app: AppDef): string | null {
  if (!app.binary) return null;
  const bundle = resolveBundle(app);
  if (!bundle) return null;
  const bin = join(bundle, "Contents", "MacOS", app.binary);
  return existsSync(bin) ? bin : null;
}

/** Resolve the installer bundle and its executable, or null. */
export function resolveInstaller(app: AppDef): { bundle: string; binary: string } | null {
  if (!app.installerBundle) return null;
  const bundle = join(INSTALLERS_DIR, app.installerBundle);
  if (!existsSync(bundle)) return null;
  const execName = app.installerBundle.replace(/\.app$/, "");
  const binary = join(bundle, "Contents", "MacOS", execName);
  return existsSync(binary) ? { bundle, binary } : null;
}
