# macOS Host & Persistence Security Report
**Host:** Joels-MacBook-Pro · **Date:** 2026-06-22 (updated 2026-06-23)
**Tools:** KnockKnock (persistence) + TaskExplorer (running processes), Objective-See

---

## Verdict: clean

No signs of compromise. Across 304 persistence items and 76 running non-Apple
processes, nothing is unsigned-and-running, nothing has VirusTotal detections, and
nothing is phoning out suspiciously. Protections are on: **SIP enabled, Gatekeeper
enabled** (verified via `csrutil status` / `spctl --status`). A couple of items are worth
a glance for hygiene reasons, noted below — none are threats.

---

## Resolved: `gkreport` / `tmp_cleaner` were a false alarm (stock macOS)

An initial pass flagged `/usr/libexec/gkreport` and `/usr/libexec/tmp_cleaner` as unsigned
binaries posing as Apple daemons. **Follow-up disk forensics disproved that** — they are
legitimate macOS system scripts:

- Located on `/dev/disk3s1s1` (the sealed, signed System snapshot); flags `restricted,compressed`;
  owner `root:wheel`; OS-build date — i.e. part of Apple's sealed system image, which can't host
  third-party files while SIP is enabled.
- `file` confirms they're **shell scripts**, which is why `codesign` said "not signed" — scripts
  carry no code signature; that flag was meaningless here.
- Contents confirm purpose: `tmp_cleaner` is the standard `/tmp` cleanup; `gkreport` *reports*
  Gatekeeper state to Apple's MessageTracer (it does not bypass Gatekeeper).

No action needed; these are normal system housekeeping.

---

## Hygiene notes (not threats)

**TeamViewer** — full remote-access stack, signed (TeamViewer Germany GmbH), persistent and
running (`TeamViewer`, `TeamViewer_Service`, `com.teamviewer.KeychainService`). Highest-capability
software on the box; keep only if you use it, else uninstall.

**"Claude God"** — ad-hoc-signed app in `~/.Trash`, not running. Confirm it was you, empty Trash.

**Apps running from the Trash** — Setapp (`SetappLauncher`, `FinderSyncExt`) and a Sofa widget are
executing out of `~/.Trash` (they were trashed while running). Signed/legit; a restart clears them.

**Other remote/network reach (signed, expected if intentional):** ExpressVPN daemon, Radio Silence
network system-extension, Docker (`com.docker.vmnetd`), Proton Drive.

---

## What was checked

- **Persistence (KnockKnock):** 304 items / 20 categories. Everything signed/notarized; the only
  "unsigned" entries are shell scripts and browser extensions, which aren't code-signed by nature.
- **Running processes (TaskExplorer, `-explore -skipVT`, run as root):** 76 non-Apple tasks —
  52 Developer-ID, 15 Mac App Store, 8 ad-hoc (the `node`/`python3.12`/`uv` dev toolchain), and
  `kernel_task`. No unsigned user processes, no suspicious paths.

## Caveat

TaskExplorer was run with `-skipVT` (VT lookups on every task stall on the public-API rate limit),
so running processes were not VirusTotal-checked. The signing picture is clean regardless. If you
want VT coverage on a specific app (e.g. a sideloaded install), scan it by name/path directly.
