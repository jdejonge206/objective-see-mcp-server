# Scheduled Host-Persistence Scan — Task Logic

This is the instruction body for the **scheduled** scan task. It is written to
**degrade gracefully**: it tries live MCP scans, falls back to the most recent
manual results in `Results/`, and **always produces a report** — never a bare
permissions failure.

Paste this as the scheduled task's instructions (replacing the previous version).

---

## Task

Run a macOS host/persistence security scan using the Objective-See MCP tools and
produce a concise report. Load tool schemas via ToolSearch (keyword
`objective-see`) if not already available. Run autonomously; make reasonable
choices and note them. Take **no** write actions. Do **not** attempt FileMonitor
(needs root; out of scope). Do **not** try to fix permissions yourself.

## Steps

1. **Tool status.** Call `os_status`. If a needed tool isn't installed, note it
   and skip rather than failing.

2. **Live KnockKnock.** Call `knockknock_scan`.
   - Success → use the result.
   - Permission failure (Full Disk Access / passwordless sudo unavailable) → do
     **not** fail. Record "KnockKnock live scan blocked: <reason>" and continue.

3. **Live TaskExplorer.** Call `taskexplorer_scan` with `skip_vt=true`.
   - Success → use the result.
   - "requires root" / timeout → record "TaskExplorer live scan blocked: <reason>"
     and continue.

4. **Fallback to disk.** If either live scan was blocked, list the `Results/`
   folder for the most recent `KnockKnock_Results_*.json` and
   `TaskExplorer_Results_*.json`. If found, read and analyze those instead.
   Always state the **file date** in the report so staleness is visible.

5. **Always write a report.** Cover, with anything needing attention at the top:
   new/unexpected persistence items; unsigned or unusual running processes; any
   VirusTotal detections (if present in the data); and an overall
   "looks normal / worth a look" verdict. Label each finding's **provenance**
   (live MCP, or manual file from `<date>`).

6. **If neither live nor disk data is available**, the report's top line must be:

   > ⚠️ Autonomous scan blocked and no recent manual results found — run the
   > manual runbook, then re-run this task.

   …followed by the two runbook commands inline (so the user can act without
   opening another file):

   ```bash
   cd /Users/jdejonge/Documents/GitHub/monitoring/objective-see-mcp-server
   sudo /Applications/KnockKnock.app/Contents/MacOS/KnockKnock -whosthere -pretty -skipVT \
     > "Results/KnockKnock_Results_$(date +%F).json"
   sudo /Applications/TaskExplorer.app/Contents/MacOS/TaskExplorer -explore -skipVT -pretty \
     > "Results/TaskExplorer_Results_$(date +%F).json"
   ```

   Full details and gotchas: `docs/RUNBOOK.md`.

---

## Why it's built this way

The scheduled task hits the **host-launched** MCP server instance, which (today)
lacks Full Disk Access and passwordless root — so live scans can fail. Rather
than erroring out and producing nothing, the task falls back to the freshest
manual scan on disk, and only if there's nothing at all does it emit an
actionable "run the runbook" prompt. You always get a report; it always tells
you how current the data is and what to do if it's stale.

**Lasting fix (separate work):** give the host-launched server Full Disk Access
and ensure it inherits `OS_USE_SUDO=true` + the sudoers rule. Until that's
pinned down, this degradation keeps the scheduled scan useful.
