# Objective-See MCP Server <img src=https://objective-see.org/images/logoApple.png style="width:40px;height:40px"><span style=color:#95c02d;font-size:15px>®</span>

An MCP server that wraps [Patrick Wardle's Objective-See](https://objective-see.org)
macOS security tools so an AI agent (Claude Desktop, Claude Code, Cowork) can run
scans, capture event streams, control the GUI tools, and schedule recurring scans.
It speaks MCP over **stdio** and shells out to each tool's own command-line interface.

## Integration status

_Last updated: June 25, 2026_

| Tier | Tools | Status |
|------|-------|--------|
| Snapshot scanners | KnockKnock, TaskExplorer, Netiquette | ✅ working |
| Streaming monitors | FileMonitor, ProcessMonitor, DNSMonitor | ⚠️ need root + Endpoint Security approval |
| GUI / daemon control | BlockBlock, OverSight, DoNotDisturb, ReiKey, RansomWhere, KextViewr, WhatsYourSign, DHS | ✅ control-level (launch / install / uninstall / status) |

> **Reliability note.** Live scans through an MCP client only work when *that
> client's* server process has the right macOS permissions: Full Disk Access for
> KnockKnock / TaskExplorer, and passwordless root for the monitors and full
> TaskExplorer detail. The host app often launches the server without those, so
> when a live scan is blocked, use the **manual runbook** and let the agent read
> the results off disk — see below.

## Running scans — two paths

**1. Live (autonomous).** The agent calls a scan tool directly. This works when
the server process the client launched has Full Disk Access (+ passwordless root
for the monitors and full TaskExplorer detail). Best for the snapshot scanners
once permissions are squared away.

**2. Manual runbook (reliable fallback).** You run the privileged scan yourself in
a terminal that already has the permissions, write the JSON to `Results/`, and the
agent reads and analyzes it off disk. This sidesteps the MCP-instance,
Full-Disk-Access, and request-timeout problems all at once.

- Manual scan steps & gotchas → [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- Graceful-degradation logic for the scheduled scan (tries live → falls back to
  the freshest `Results/` file → emits an actionable prompt if neither is
  available) → [`docs/SCHEDULED-TASK.md`](docs/SCHEDULED-TASK.md)

📍 **Roadmap** → [`docs/ROADMAP.md`](docs/ROADMAP.md): privilege integration
(unblocking the root-only tools for autonomous runs) and headless facsimiles of
the GUI-only tools.

## What is this?

The Objective-See suite is a set of focused macOS security/forensics utilities,
normally used interactively through their GUIs. Several of them also ship a
command-line interface that emits **JSON** — and that's the enabler. Wrapping the
JSON-capable tools in MCP turns a pile of separate apps into one coherent toolkit
an agent can reason over and chain together: persistence scan → process scan →
network snapshot → correlate, all in one conversation. See
[`DESIGN.md`](DESIGN.md) for the full rationale.

## What's integrated, and how

The 14 Objective-See tools fall into three tiers based on what their binaries
actually expose (verified by inspecting each one):

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

**About ReiKey & RansomWhere specifically:** they have *no* data/scan CLI — you
can't pull JSON out of them the way you can with KnockKnock. But they each ship an
installer that accepts `-install` / `-uninstall`, and they run as persistent
login-item/daemon monitors once installed. So they're integrated at the control
level: `os_install_tool` (which makes them auto-run at login — the practical
equivalent of "scheduling"), `os_launch_tool`, `os_uninstall_tool`, and
`os_status`. A true recurring *schedule* only makes sense for the snapshot
scanners, which is what `os_schedule_scan` covers.

## Tools

**Scanners (read-only, run as your user; richer with `use_sudo`)**
- `knockknock_scan` — `{ include_apple?, use_sudo?, timeout_seconds? }`
- `taskexplorer_scan` — `{ pid?, include_apple?, skip_vt?, use_sudo?, timeout_seconds? }` (`skip_vt` defaults **true**: VirusTotal lookups on every task stall on the public-API rate limit, so the default uses `-explore -skipVT`; set `skip_vt:false` only for a single-`pid` scan)
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
        "OS_INSTALLERS_DIR": "/Users/jdejonge/Downloads/Applications/Security/packages and installers",
        "OS_USE_SUDO": "true"
      }
    }
  }
}
```

`OS_INSTALLERS_DIR` only matters for `os_install_tool` / `os_uninstall_tool`; point
it at wherever you keep the `… Installer.app` bundles. The standalone
scanner/monitor apps are found via `OS_APPS_DIR`.

> For the host-launched server to run the root tools autonomously, this process
> needs Full Disk Access **and** the passwordless sudoers rule below — granted to
> whatever app actually launches `node` (the desktop app, not your terminal). Until
> that's pinned down, prefer the [manual runbook](docs/RUNBOOK.md).

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `OS_APPS_DIR` | `/Applications` | Where the standalone `.app` bundles live |
| `OS_INSTALLERS_DIR` | `=` `OS_APPS_DIR` | Where the `… Installer.app` wrappers live |
| `OS_USE_SUDO` | `true` | Set `false` if the server itself runs as root |
| `OS_LAUNCH_AGENTS_DIR` | `~/Library/LaunchAgents` | Where scheduled-scan plists are written |
| `OS_SCAN_LOG_DIR` | `~/Library/Logs/objective-see-mcp` | Where scheduled-scan JSON logs go |

## Permissions: the important part

These are real security tools, so macOS gates them:

1. **Full Disk Access** — grant it to KnockKnock, TaskExplorer, Netiquette,
   FileMonitor, ProcessMonitor (System Settings → Privacy & Security → Full Disk
   Access). Without it, scans return little or nothing. macOS caches this grant at
   process launch and attributes it to the *responsible parent* process, so the
   app that launches the server must have FDA **and** be (re)launched after the
   grant.
2. **Endpoint Security / approval** — the three monitors and several daemons
   require a system approval the first time. Launch each once from the GUI
   (`os_launch_tool`) and approve the prompt before driving it headlessly.
3. **Root for monitors (and full TaskExplorer detail)** — FileMonitor /
   ProcessMonitor / DNSMonitor must run as root, and TaskExplorer requires root for
   a complete scan (it exits with `requires root` otherwise). The server uses
   `sudo -n` (non-interactive) whenever a call passes `use_sudo=true`. Pick one:
   - run the MCP server as root and set `OS_USE_SUDO=false`, **or**
   - add a passwordless sudoers rule (`sudo visudo -f /etc/sudoers.d/objective-see`,
     adjust the username and paths):
     ```
     your_user ALL=(root) NOPASSWD: /Applications/TaskExplorer.app/Contents/MacOS/TaskExplorer, \
       /Applications/FileMonitor.app/Contents/MacOS/FileMonitor, \
       /Applications/ProcessMonitor.app/Contents/MacOS/ProcessMonitor, \
       /Applications/DNSMonitor.app/Contents/MacOS/DNSMonitor
     ```
   Because the rule pins each tool to its absolute binary path, this grants
   passwordless root *only* to those specific Objective-See executables — nothing
   else. After saving, call `taskexplorer_scan` with `use_sudo=true`. If
   passwordless sudo isn't available, the affected tools return a clear, actionable
   error instead of hanging.

## Notes & limitations

- Monitors are **streaming**; this server captures a bounded window
  (`duration_seconds`, max 120) and returns the collected JSON events rather than
  streaming indefinitely. Large captures are capped at 2000 returned events.
- `os_schedule_scan` writes a standard launchd `LaunchAgent` and loads it with
  `launchctl`. Schedules run as your user, so the scanner app still needs Full Disk
  Access for full results.
- `DHS` exposes no CLI at all — it's launch/status only.
- This wraps third-party tools; it doesn't redistribute them. Install them yourself
  from objective-see.org and keep them updated.

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
docs/
  RUNBOOK.md          manual scan steps & gotchas (reliable fallback path)
  SCHEDULED-TASK.md   graceful-degradation logic for the scheduled scan
  ROADMAP.md          planned work
  PROPOSAL-headless-editions.md
DESIGN.md             why it's built this way
Results/              scan JSON output, read back by the agent
```

---
<p align="center">
<span style="color:#95c02d;font-size:200%">Objective</span><span style="color:#798992;font-size:200%">-See</span><br>
<span style="color:#798992;font-size:14px">a non-profit 501(c)(3) foundation.</span><br>
All credit goes to <a href="https://objective-see.org/" target="_blank">Patrick Wardle</a>.<br>
<img src=https://objective-see.org/images/logoApple.png>
</p>
