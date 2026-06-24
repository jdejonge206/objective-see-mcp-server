# Implementation roadmap

Status: **draft for review** · Scope: the two workstreams needed to "finish" the server —
(A) make the root-requiring tools actually run, and (B) add headless facsimiles for the
GUI-only tools that have no data CLI. This doc is the agreed plan before any code is written.

---

## 0. Where things stand today

The server is a Node/TypeScript subprocess adapter (see `DESIGN.md`). The tool code for the
privileged tools **already exists and is registered** — the gap is operational, not missing code.

| Tool | Tier | Code wired up? | Runs today? | Blocker |
|------|------|----------------|-------------|---------|
| KnockKnock | snapshot | yes | **yes** | Full Disk Access granted ✓ |
| Netiquette | snapshot | yes | yes (user) | none |
| TaskExplorer | snapshot | yes | **ostensibly** | needs to be double checked :: needs root; `sudo -n` refused |
| FileMonitor | monitor | yes | **no** | needs root **and** Endpoint Security approval |
| ProcessMonitor | monitor | yes (not installed) | **no** | not installed; needs root + ES approval |
| DNSMonitor | monitor | yes | **no** | needs root **and** a system/network-extension approval |
| BlockBlock / OverSight / RansomWhere / ReiKey / DoNotDisturb | gui (daemon) | control only | n/a | event-driven daemons — no snapshot to query |
| KextViewr / WhatsYourSign / DHS | gui (static) | control only | n/a | **facsimile candidates** (workstream B) |

Two independent things are conflated under "needs root," and the roadmap keeps them separate
because they have different fixes:

1. **Privilege (sudo/root).** `exec.ts` already supports both `sudo -n` and run-as-root
   (`OS_USE_SUDO=false`). Nothing has *configured* a non-interactive root path, so `sudo -n`
   is refused. This is the only blocker for **TaskExplorer**. → Workstream A.
2. **OS approvals (TCC / Endpoint Security / network extension).** The three monitors also need a
   one-time, **interactive** system approval that `sudo` cannot grant. Root is necessary but not
   sufficient for them. The roadmap is honest that this step can't be fully automated. → Workstream A, second half.

---

## Workstream A — make the root tools run

Goal: after a one-time setup, `taskexplorer_scan`, `filemonitor_capture`,
`processmonitor_capture`, and `dnsmonitor_capture` succeed non-interactively.

### A1. Privilege path (decision pending — pick at this step)

The server needs a way to reach root without a password prompt. Three options, least- to
most-privileged surface:

- **Scoped sudoers drop-in.** Generate `/etc/sudoers.d/objective-see-mcp` granting `NOPASSWD`
  for *only* the specific Objective-See binaries (by absolute path), validated with `visudo -c`
  before install. Server stays unprivileged; only the named tools can elevate. Most work, least
  blast radius. Caveat: app-bundle binary paths change if apps are reinstalled elsewhere; the
  generator must resolve current paths and the entries should pin them.
- **Run server as root.** Ship a `LaunchDaemon` plist that runs the server as root with
  `OS_USE_SUDO=false`. Simplest to operate; broadest privilege (the whole server and anything it
  spawns is root). 
- **SMJobBless privileged helper.** A signed helper installed once, brokering only the approved
  scans. Cleanest security model, heaviest to build (requires a signing identity + helper
  lifecycle). Likely overkill here; documented for completeness.

**Deliverables (independent of which option is chosen):**
- `scripts/setup-privileges.sh` — interactive, idempotent installer for the chosen path; prints
  exactly what it will do and validates before applying. Reversible (`--uninstall`).
- A read-only **`os_check_privileges`** MCP tool (or extend `os_status`) that reports, per tool:
  resolvable binary? `sudo -n` working? — so the agent can tell *why* a tool is blocked instead
  of getting a generic failure.
- README section documenting all three options and the trade-offs.

### A2. OS approval handling (TCC / ES / network extension)

The monitors need an interactive grant the first time. We can't click the dialog for the user,
but we can make it a clean, one-time guided step:
- Verify, per monitor, which subsystem the approval actually belongs to (FileMonitor & ProcessMonitor =
  Endpoint Security; DNSMonitor = system/network extension — **confirm during implementation**,
  don't assume).
- `os_check_privileges` should also surface "approval likely missing" by distinguishing
  "no events + permission warning on stderr" from "no events in window."
- Improve the monitor error messages to name the exact approval needed and where to grant it
  (System Settings pane), instead of the current generic hint.

### A3. Tasks
1. Probe each privileged binary's real flags/behavior under sudo (don't trust this doc — verify).
2. Implement `os_check_privileges` (read-only diagnostics).
3. Implement `scripts/setup-privileges.sh` for the chosen A1 option.
4. Wire actionable, approval-specific errors into `monitors.ts` / `scanners.ts`.
5. Update README + `claude_desktop_config.example.json` with the setup flow.
6. Verify end-to-end: TaskExplorer returns JSON; each monitor returns events in a short window.

---

## Workstream B — headless facsimiles

This builds on the existing `docs/PROPOSAL-headless-editions.md`, which already specifies the
three tools, their stock-primitive backing, and I/O schemas. The roadmap only adds the build
breakdown and how they slot in.

Scope is the **three static-inspection** GUI tools — they reimplement cleanly because they read
state rather than stream events. The other GUI tools (BlockBlock, OverSight, RansomWhere, ReiKey,
DoNotDisturb) are event-driven daemons and are **out of scope for facsimiles**; they stay at the
control layer (launch/install/uninstall/status), which is the honest representation.

Legal note carried over from the proposal: we reimplement *behavior* from documented OS APIs and
ship original code credited as "inspired by" — we do not read or copy Objective-See source.

### Build order (each reuses the previous)
1. **`whatsyoursign_check`** — code-signing/notarization inspector over `codesign` / `spctl` /
   `pkgutil` / `stapler` / `shasum`. ~1–2 d. Produces the shared `src/services/signing.ts` helper.
2. **`kextviewr_list`** — loaded kext / system-extension inventory over `kmutil showloaded` +
   `systemextensionsctl list`, reusing the signing helper. ~1–3 d.
3. **`dhs_scan`** — dylib-hijack opportunity scanner over `otool -l`, emulating dyld rpath
   resolution and cross-checking hardened-runtime/library-validation (via the helper) to suppress
   false positives. ~3–5 d; needs a fixtures dir of known-good/known-vulnerable binaries.

### Tasks
1. `src/services/signing.ts` + unit tests against a few known binaries (signed Apple, signed
   3rd-party, unsigned, notarized).
2. New `src/tools/inspect.ts` registering the three tools; register it in `index.ts`.
3. In `constants.ts`, give the `whatsyoursign` / `kextviewr` / `dhs` GUI entries a note pointing
   at their headless equivalents (keep their launch/control registration).
4. Fixtures dir + tests for `dhs_scan`'s dyld emulation.
5. README: document the three new data tools alongside the scanners.

### Open questions (from the proposal, still need answers)
- `dhs_scan` default scope: `/Applications` only, or also `~/Applications` and running processes?
- `whatsyoursign_check` v1: Mach-O/app only, or also `.pkg` / `.dmg`?
- Three separate tools (recommended) vs one `os_inspect` tool with a `mode` arg?

---

## Suggested sequencing

A and B are independent and could interleave, but a sensible single-threaded order:

1. **A2/A3 diagnostics first** (`os_check_privileges`) — small, immediately useful, makes every
   later step debuggable.
2. **A1 privilege setup** — unblocks 4 existing tools in one move (highest leverage).
3. **B1 WhatsYourSign** — foundation helper; pure orchestration, low risk.
4. **B2 KextViewr**, then **B3 DHS** — DHS last since its dyld emulation is the real work.

Milestone "root tools green" = end of step 2. Milestone "facsimiles shipped" = end of step 4.

## Cross-cutting
- Every new data tool: `readOnlyHint: true`, parse defensively (reuse `parseJsonLoose`), cap
  output via the existing `CHARACTER_LIMIT` / truncation path.
- Keep the registry-driven structure: new tools go through `constants.ts` + a per-tier module, no
  ad-hoc registration.
- Add tests to the existing build pipeline; DHS gets fixtures.
