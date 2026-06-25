# Manual Scan Runbook — Objective-See MCP

**Purpose:** the reliable path to a full host/persistence scan when autonomous
MCP scanning is blocked by macOS permissions. *You* run the privileged scans;
Claude reads the JSON from `Results/` and analyzes it. This sidesteps the MCP
instance, Full Disk Access, and request-timeout problems all at once.

## Why this is the reliable path

- Claude's MCP tool calls reach **only the server the host app launches** — not
  a server you start by hand in a terminal. That host-launched instance may lack
  Full Disk Access (needed by KnockKnock) and passwordless root (needed by
  TaskExplorer), so live scans can fail or time out.
- Running the CLI tools yourself uses **your shell's granted permissions** (FDA +
  the `/etc/sudoers.d/objective-see` NOPASSWD rule), which already work. Output
  written to `Results/` is then readable by Claude off disk.

## Step 0 — confirm permissions are in place (once per terminal session)

```bash
# Full Disk Access: your terminal app must be ON in
# System Settings -> Privacy & Security -> Full Disk Access,
# and the terminal must have been LAUNCHED AFTER the toggle was set
# (macOS caches the TCC grant at launch — restart the terminal if unsure).

# sudoers rule: should list the four Objective-See binaries with NOPASSWD
sudo cat /etc/sudoers.d/objective-see

# Test passwordless root (should NOT prompt for a password):
sudo -n /Applications/TaskExplorer.app/Contents/MacOS/TaskExplorer -h
```

## Step 1 — KnockKnock (persistence)

```bash
cd /Users/jdejonge/Documents/GitHub/monitoring/objective-see-mcp-server
sudo /Applications/KnockKnock.app/Contents/MacOS/KnockKnock -whosthere -pretty -skipVT \
  > "Results/KnockKnock_Results_$(date +%F).json" 2>/tmp/kk.err
echo "exit=$? bytes=$(wc -c < "Results/KnockKnock_Results_$(date +%F).json")"; head -5 /tmp/kk.err
```

`sudo` gives a fuller scan (e.g. other users' cron jobs). Expect a big `bytes=`
number. `-skipVT` keeps it fast; VirusTotal-check individual hashes by hand later.

## Step 2 — TaskExplorer (running processes)

```bash
cd /Users/jdejonge/Documents/GitHub/monitoring/objective-see-mcp-server
sudo /Applications/TaskExplorer.app/Contents/MacOS/TaskExplorer -explore -skipVT -pretty \
  > "Results/TaskExplorer_Results_$(date +%F).json" 2>/tmp/te.err
echo "exit=$? bytes=$(wc -c < "Results/TaskExplorer_Results_$(date +%F).json")"; head -5 /tmp/te.err
```

This takes a while (~12 minutes on this machine) because `-explore` enumerates
every task and its dylibs. That's normal — wait for the `exit=0 bytes=...` line.

## Step 3 — hand off to Claude

> "Read the latest files in `Results/` and produce a host/persistence report."

Claude cross-references persistence items against running processes, flags
anything unsigned-and-running or with VirusTotal detections, and gives a verdict.
Note the file dates so staleness is visible.

## Gotchas (learned the hard way)

- **GUI opens instead of printing JSON:** running interactively *without* a
  redirect can pop the app's GUI. Always redirect stdout to a file (as above).
- **0-byte output file:** output went to stderr or the scan stalled. Check
  `/tmp/te.err` / `/tmp/kk.err`, and make sure `-skipVT` is present.
- **VirusTotal stall:** `-explore` *without* `-skipVT` queries VT per process
  (~4/min against hundreds of processes → effectively an hour-long hang). Always
  use `-skipVT`; check the few suspicious hashes manually at virustotal.com.
- **"not signed at all" on shell scripts is normal:** only Mach-O binaries and
  app bundles carry code signatures. Scripts in `/usr/libexec` flagged
  `restricted,compressed` on the sealed system volume (`/dev/diskNsNsN`) are
  stock macOS — their integrity comes from the volume seal, not a signature.
