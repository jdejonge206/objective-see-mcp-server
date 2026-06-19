# objective-see-mcp-server

An MCP server that wraps [Patrick Wardle's Objective-See](https://objective-see.org) macOS
security tools so an AI agent (Claude Desktop, Claude Code, etc.) can run scans, capture
event streams, launch/install the GUI tools, and put recurring scans on a schedule.

It speaks MCP over **stdio** and shells out to the tools' own command-line interfaces.

## What's integrated, and how

The 14 Objective-See tools fall into three tiers based on what their binaries actually expose
(verified by inspecting each one):

| Tool | Tier | How it's integrated |
|------|------|---------------------|
| **KnockKnock** | Snapshot scanner | `knockknock_scan` — JSON report of persistent software |
| **TaskExplorer** | Snapshot scanner | `taskexplorer_scan` — processes + hashes, signatures, VT, dylibs, connections |
| **Netiquette** | Snapshot scanner | `netiquette_list` — current network connections |
| **FileMonitor** | Streaming monitor | `filemonitor_capture` — file events for a time window (root) |
| **ProcessMonitor** | Streaming monitor | `processmonitor_capture` — process events for a time window (root) |
| **DNSMonitor** | Streaming monitor | `dnsmonitor_capture` — DNS events for a time window (root) |
| **BlockBlock** | GUI / daemon | launch · install · uninstall · status |
| **OverSight** | GUI / daemon | launch · install · uninstall · status |
| **DoNotDisturb** | GUI / daemon | launch · install · uninstall · status |
| **ReiKey** | GUI / daemon | launch · install · uninstall · status |
| **RansomWhere** | GUI / daemon | launch · install · uninstall · status |
| **KextViewr** | GUI | launch · status |
| **WhatsYourSign** | GUI / Finder ext | launch · install · uninstall · status |
| **DHS** | GUI | launch · status |

**About ReiKey & RansomWhere specifically:** they have *no* data/scan CLI — you can't pull JSON
out of them the way you can with KnockKnock. But they each ship an installer that accepts
`-install` / `-uninstall`, and they run as persistent login-item/daemon monitors once installed.
So they're integrated at the control level: `os_install_tool` (which makes them auto-run at
login — the practical equivalent of "scheduling"), `os_launch_tool`, `os_uninstall_tool`, and
`os_status`. A true recurring *schedule* only makes sense for the snapshot scanners, which is
what `os_schedule_scan` covers.

## Tools

**Scanners (read-only, run as your user; richer with `use_sudo`)**
- `knockknock_scan` — `{ include_apple?, use_sudo?, timeout_seconds? }`
- `taskexplorer_scan` — `{ pid?, include_apple?, use_sudo?, timeout_seconds? }`
- `netiquette_list` — `{ skip_apple?, use_sudo?, timeout_seconds? }`

**Monitors (need root + Endpoint Security approval; bounded capture window)**
- `filemonitor_capture` — `{ duration_seconds?, filter?, skip_apple?, use_sudo? }`
- `processmonitor_capture` — `{ duration_seconds?, filter?, skip_apple?, use_sudo? }`
- `dnsmonitor_capture` — `{ duration_seconds?, use_sudo? }`

**Control**
- `os_status` — what's installed / running / has an installer available
- `os_launch_tool` — `{ tool }`
- `os_install_tool` — `{ tool, use_sudo? }` *(modifies system)*
- `os_uninstall_tool` — `{ tool, use_sudo? }` *(modifies system)*

**Scheduling (launchd LaunchAgents, snapshot scanners only)**
- `os_schedule_scan` — `{ tool, interval_seconds, include_apple?, label_suffix? }`
- `os_list_schedules`
- `os_unschedule_scan` — `{ label }`

## Install & build

```bash
cd objective-see-mcp-server
npm install
npm run build      # produces dist/index.js
```

Requires Node ≥ 18 and macOS (the wrapped tools are macOS-only).

## Configure your MCP client

Add to your client config (Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`).
Use the absolute path to the built `dist/index.js`:

```json
{
  "mcpServers": {
    "objective-see": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/objective-see-mcp-server/dist/index.js"],
      "env": {
        "OS_APPS_DIR": "/Applications",
        "OS_INSTALLERS_DIR": "/Users/jdejonge/Downloads/Applications/Security/packages and installers"
      }
    }
  }
}
```

`OS_INSTALLERS_DIR` only matters for `os_install_tool` / `os_uninstall_tool`; point it at wherever
you keep the `… Installer.app` bundles. The standalone scanner/monitor apps are found via
`OS_APPS_DIR`.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `OS_APPS_DIR` | `/Applications` | Where the standalone `.app` bundles live |
| `OS_INSTALLERS_DIR` | = `OS_APPS_DIR` | Where the `… Installer.app` wrappers live |
| `OS_USE_SUDO` | `true` | Set `false` if the server itself runs as root |
| `OS_LAUNCH_AGENTS_DIR` | `~/Library/LaunchAgents` | Where scheduled-scan plists are written |
| `OS_SCAN_LOG_DIR` | `~/Library/Logs/objective-see-mcp` | Where scheduled-scan JSON logs go |

## Permissions: the important part

These are real security tools, so macOS gates them:

1. **Full Disk Access** — grant it to KnockKnock, TaskExplorer, Netiquette, FileMonitor,
   ProcessMonitor (System Settings → Privacy & Security → Full Disk Access). Without it, scans
   return little or nothing.
2. **Endpoint Security / approval** — the three monitors and several daemons require a system
   approval the first time. Launch each once from the GUI (`os_launch_tool`) and approve the
   prompt before driving it headlessly.
3. **Root for monitors** — FileMonitor / ProcessMonitor / DNSMonitor must run as root. The
   server uses `sudo -n` (non-interactive). Pick one:
   - run the MCP server as root and set `OS_USE_SUDO=false`, **or**
   - add a passwordless sudoers rule (run `sudo visudo`, adjust paths):
     ```
     your_user ALL=(root) NOPASSWD: /Applications/FileMonitor.app/Contents/MacOS/FileMonitor, \
       /Applications/ProcessMonitor.app/Contents/MacOS/ProcessMonitor, \
       /Applications/DNSMonitor.app/Contents/MacOS/DNSMonitor
     ```
   If passwordless sudo isn't available, the affected tools return a clear, actionable error
   instead of hanging.

## Notes & limitations

- Monitors are **streaming**; this server captures a bounded window (`duration_seconds`, max 120)
  and returns the collected JSON events rather than streaming indefinitely. Large captures are
  capped at 2000 returned events.
- `os_schedule_scan` writes a standard launchd `LaunchAgent` and loads it with `launchctl`.
  Schedules run as your user, so the scanner app still needs Full Disk Access for full results.
- `DHS` exposes no CLI at all — it's launch/status only.
- This wraps third-party tools; it doesn't redistribute them. Install them yourself from
  objective-see.org and keep them updated.

## Project layout

```
src/
  index.ts            entry point, registers tools, stdio transport
  constants.ts        tool registry + capability tiers
  config.ts           env config + bundle/installer resolution
  exec.ts             command runner, monitor capture, JSON parsing, truncation
  tools/
    scanners.ts       knockknock / taskexplorer / netiquette
    monitors.ts       filemonitor / processmonitor / dnsmonitor
    control.ts        status / launch / install / uninstall
    schedule.ts       schedule / list / unschedule (launchd)
```
