# Design notes — why this MCP is built the way it is

This document explains the reasoning behind `objective-see-mcp-server`: why it exists, how the
tools were chosen and grouped, the things that were deliberately left out, and the tradeoffs
behind some of the implementation decisions (including why it's written in Node/TypeScript
rather than Python). It's meant to be useful both as a record for me later and as orientation
for anyone else who picks this up.

## Why wrap these tools in an MCP at all

The [Objective-See](https://objective-see.org) suite (by security researcher Patrick Wardle) is a
collection of focused macOS security/forensics utilities. Most people use them interactively:
open the app, look at the GUI, react to an alert. That's great for a human at the keyboard, but
it doesn't compose. You can't ask an assistant "scan this Mac for persistence, then check what's
talking to the network, and flag anything unsigned," because there's no programmatic surface for
an agent to drive.

Several of these tools, though, ship a real command-line interface that emits **JSON**. That's
the key enabler. An MCP server is essentially a typed, self-describing adapter between an
AI agent and some underlying capability. Wrapping the JSON-capable tools in MCP turns a pile of
separate GUI apps into a single coherent toolkit an agent can reason over and chain together.
The whole value proposition is composition: persistence scan → process scan → network snapshot →
correlate, all in one conversation.

## How the tools were triaged

Before writing any code I inspected every binary in the folder (`strings` on the Mach-O
executables, plus the `Info.plist`) to find out what each one actually supports on the command
line — rather than trusting documentation or memory. That probe is what produced the three tiers
the server is organized around:

**Tier 1 — Snapshot scanners (KnockKnock, TaskExplorer, Netiquette).** Each takes a flag
(`-whosthere`, `-scan`, `-list`) and prints one JSON document describing current state, then
exits. These are the ideal MCP citizens: one call in, structured data out, no lifecycle to
manage, runnable as the normal user. They became the first three tools and are the ones I'd
point a newcomer at first.

**Tier 2 — Streaming monitors (FileMonitor, ProcessMonitor, DNSMonitor).** These don't return a
snapshot; they attach to Apple's Endpoint Security subsystem and emit a *continuous* stream of
JSON events until killed. They're more powerful but harder to expose cleanly (more on that
below), and they require root plus a system approval. Worth including, but a different shape.

**Tier 3 — GUI / daemon / Finder-extension tools (BlockBlock, OverSight, DoNotDisturb, ReiKey,
RansomWhere, KextViewr, WhatsYourSign, DHS).** These have no data CLI. The "Installer" variants
do expose `-install` / `-uninstall`, and most run as persistent background monitors once
installed. So there's nothing to *query*, but there's still plenty to *control*: launch them,
install/uninstall them, and report their status. That's the control layer.

This tiering isn't cosmetic — it drove the file structure (`tools/scanners.ts`,
`tools/monitors.ts`, `tools/control.ts`, `tools/schedule.ts`) and the tool annotations
(scanners are `readOnlyHint: true, idempotentHint: true`; install/uninstall are
`destructiveHint: true`).

## What was deliberately left out, and why

- **Malwarebytes** — excluded at the user's request; it's a heavyweight commercial installer,
  not part of the Objective-See suite, and not a good MCP fit.
- **DHS (Dylib Hijack Scanner)** — kept, but launch/status only. Its binary exposes *no*
  command-line flags at all, so there's genuinely nothing to wrap beyond opening it.
- **ReiKey & RansomWhere as data sources** — these can't be queried; they have no scan CLI.
  Rather than fake it, they're integrated honestly at the control level (launch/install/
  uninstall/status). For a persistent monitor, "install it so it auto-runs at login" *is* the
  deployment story — there's no periodic job to schedule, because it's always on.

The guiding principle: expose each tool at the highest-fidelity level its binary actually
supports, and don't pretend a capability exists when it doesn't. An honest "this is launch-only"
is more useful to an agent than a tool that silently returns nothing.

## A few implementation decisions worth explaining

**Bounded capture for the streaming monitors.** An MCP tool call is request/response — it has to
return. A monitor that streams forever doesn't fit that shape. So the monitor tools take a
`duration_seconds` window, run the monitor under a small shell wrapper that starts it, sleeps,
then signals it to stop, and return the JSON events collected in that window. Running the monitor
*and* the kill inside one `sh -c` matters: when elevated, the kill happens with the same
privileges as the monitor, so we don't end up with an orphaned root process we can't stop.

**Non-interactive privilege handling.** The monitors and the installers need root. An MCP server
runs headless, so a `sudo` password prompt would just hang. The server uses `sudo -n`
(non-interactive) and, when that's refused, returns a specific, actionable error explaining the
two clean fixes (run the server as root with `OS_USE_SUDO=false`, or add a scoped sudoers rule)
instead of blocking. Predictable failure beats a hang.

**Parsing defensively.** Snapshot output is parsed "loosely" — if a tool prints a one-line banner
before its JSON, we locate the first `{`/`[` and parse from there. Monitor output is parsed as
newline-delimited JSON, with non-JSON lines collected separately so a banner or a permission
warning surfaces as a diagnostic rather than crashing the parse. Real-world CLI output is messy;
the wrapper absorbs that.

**Scheduling via launchd, scanners only.** "Run a scan on a routine" maps naturally to a launchd
`LaunchAgent` with a `StartInterval`, writing timestamped JSON to a log. That's what
`os_schedule_scan` generates and loads. It's offered only for the snapshot scanners because
they're the only tools where periodic execution is meaningful — the monitors and daemons are
continuous by design. The unschedule tool refuses to touch any label that doesn't carry this
server's prefix, so it can't be turned into a generic "delete arbitrary LaunchAgents" primitive.

**Character limits and truncation.** Tool output can be large (a full TaskExplorer scan is
hefty). Responses are capped with a clear truncation note, and monitor results cap the number of
returned events, so a single call can't blow out an agent's context.

## Node/TypeScript vs Python — the tradeoff

Both the MCP TypeScript SDK and the Python SDK (FastMCP) are first-class, and this server would
work in either. It's in TypeScript, which was the user's call, and that choice is defensible on
the merits:

- **Distribution.** A built Node server is a single `dist/index.js` plus a `package.json`. It
  drops straight into a Claude Desktop / Claude Code `mcpServers` config with `command: "node"`,
  with no virtualenv or interpreter-version juggling. Python's packaging story
  (venv vs pipx vs uv, system Python vs Homebrew Python) is more friction for a tool people are
  meant to clone and run. TypeScript also lines up with the MCPB bundle format if this is ever
  packaged that way.
- **Schema ergonomics.** The TS SDK pairs with Zod, so input validation, the generated
  JSON Schema the agent sees, and the static types in the handler all come from one declaration.
  Python's Pydantic is comparably good — this is roughly a wash, slightly favoring whichever
  ecosystem you're fluent in.
- **The actual work here is subprocess orchestration**, not heavy data processing — spawning
  binaries, capturing stdout, parsing JSON, managing a timed kill. Node's `child_process` and
  event-loop model are a comfortable fit, and there's no CPU-bound or scientific-computing
  workload that would tilt things toward Python's data libraries.
- **Where Python might have won:** if this needed to do serious post-processing of results
  (dataframes, statistics, ML on the event streams) or slot into an existing Python security
  pipeline, FastMCP would be the more natural home. It doesn't, so that advantage doesn't apply.

Net: for a thin, well-typed, easily-distributed adapter over local CLI tools, Node/TypeScript is
a clean fit. Python would have been a perfectly reasonable alternative and the architecture
(registry + resolver + exec helpers + per-tier tool modules) would translate almost directly.

## Security posture

This server can launch processes, install/uninstall system software, and run privileged
monitors. A few choices keep that bounded: read-only scans are the default and clearly annotated;
anything that changes the system is marked destructive and requires an explicit tool call;
privilege escalation is non-interactive and scoped; and the scheduler can only remove schedules
it created. It also only *wraps* the Objective-See tools — it never bundles or redistributes
them. Install them yourself from objective-see.org and keep them updated.
