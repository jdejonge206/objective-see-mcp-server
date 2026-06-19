# Proposal: headless editions of three GUI-only tools

Status: **draft for review** · Author: generated for Joel DeJonge · Scope: adds three new
data-returning MCP tools that reimplement the *function* of three Objective-See GUI apps using
stock macOS primitives.

## Why these three

Of the eight GUI-only tools in the suite, three do work that is essentially **static inspection**
— reading signatures, listing loaded code, analyzing binary structure. Static inspection needs no
event stream, no daemon, and no kernel hooks, so it can be rebuilt from command-line tools that
ship with every Mac. That makes them the high-value, low-risk additions:

| GUI tool | What it shows | Stock primitive(s) it can be rebuilt on | Effort |
|----------|---------------|------------------------------------------|--------|
| WhatsYourSign | Code-signing / notarization info for a file | `codesign`, `spctl`, `pkgutil`, `stapler` | Low |
| KextViewr | Loaded kernel/system extensions + signing | `kmutil`, `systemextensionsctl`, `codesign` | Low–Med |
| DHS | Dylib-hijacking opportunities in an app | `otool -l` (Mach-O load commands) | Medium |

Important legal note: we reimplement *behavior* from documented OS APIs. We do **not** read or
copy Objective-See's source. Behavior/ideas aren't copyrightable; source code is. So these ship
as original implementations, credited as "inspired by" the originals.

A useful side effect: signing analysis is the foundation for the other two (KextViewr wants
signing info per kext; DHS needs it to suppress false positives), so building WhatsYourSign first
gives a `signing` helper the others reuse. Recommended build order: **WhatsYourSign → KextViewr →
DHS**.

---

## 1. `whatsyoursign_check` — code-signing & notarization inspector

**What the GUI does.** Right-click any file in Finder and see: is it signed, by whom (the full
authority chain), is it notarized, what's its hash, what type of item is it.

**Headless approach.** Everything WhatsYourSign surfaces is available from CLI tools:

- `codesign -dvvv --verbose=4 <path>` → signing authorities, Team ID, CDHash, format, flags
  (note: writes to **stderr**, so capture both streams).
- `codesign --verify --deep --strict <path>` → is the signature actually valid / intact.
- `codesign -d --entitlements :- --xml <path>` → entitlements.
- `spctl --assess --type execute -vv <path>` (apps) / `--type install` (pkgs) → Gatekeeper
  verdict, which reports **notarization** ("source=Notarized Developer ID").
- `pkgutil --check-signature <path>` → installer-package signing.
- `xcrun stapler validate <path>` → whether a notarization ticket is stapled.
- `shasum -a 256` (or Node `crypto`) → SHA-256; `file` / UTI → item type.

**Proposed tool**

```
whatsyoursign_check
  input:  { path: string, include_entitlements?: bool = false }
  output: {
    path, type,                      // e.g. "application/x-mach-binary", "pkg"
    signed: bool,
    valid: bool,                     // signature intact (codesign --verify)
    authorities: string[],          // leaf → root
    team_id: string|null,
    cdhash: string|null,
    hardened_runtime: bool,
    notarized: bool,                 // from spctl assessment
    gatekeeper: "accepted"|"rejected"|"unknown",
    stapled: bool,
    sha256: string,
    entitlements?: object|null
  }
```

**Effort:** ~1–2 days. Pure command orchestration + parsing.

**Caveats:** `codesign` output is on stderr and its text format is quirky (parse defensively, like
the existing scanners). `spctl` may consult the network for revocation; assessment still works
offline for the common cases. Annotate `readOnlyHint: true`.

---

## 2. `kextviewr_list` — loaded kernel/system extension inventory

**What the GUI does.** Lists every loaded kernel extension with bundle ID, version, path, code
signature, and hash — so you can spot unsigned or unexpected kernel code.

**Headless approach.**

- `kmutil showloaded --list-only` (macOS 11+) → loaded kexts (replaces deprecated `kextstat`).
- `systemextensionsctl list` → modern System Extensions (the user-space successor to kexts).
- For each resolved bundle path, reuse the signing helper from tool #1 for authorities + hash.
- Tag each entry `apple: true/false` by Team ID / authority so callers can filter the (large)
  Apple baseline and focus on third-party code.

**Proposed tool**

```
kextviewr_list
  input:  { include_apple?: bool = false, use_sudo?: bool = false }
  output: {
    count,
    extensions: [ {
      bundle_id, version, path,
      kind: "kext"|"system_extension",
      signed: bool, authorities: string[], team_id, sha256,
      apple: bool
    } ]
  }
```

**Effort:** ~1–3 days, mostly `kmutil` output parsing + reuse of the signing helper.

**Caveats:** modern macOS (esp. Apple Silicon) deliberately limits third-party kexts, so most
output will be Apple system extensions — that's expected, not a bug. Some detail needs root;
SIP hides certain fields. `readOnlyHint: true`.

---

## 3. `dhs_scan` — dylib-hijack opportunity scanner

**What the GUI does.** Scans applications for **dylib hijacking** weaknesses — places where an
attacker could drop a malicious `.dylib` that a legitimate app would then load. Two classic
categories:

- **Weak hijack:** a `LC_LOAD_WEAK_DYLIB` load command points at a dylib that doesn't exist on
  disk. Because it's *weak*, the app still launches without it — so an attacker can simply create
  that missing file and get their code loaded.
- **Rpath hijack:** an `@rpath/...` import combined with multiple `LC_RPATH` search paths, where
  the real dylib lives in a *later* search dir but an *earlier* one is missing or
  attacker-writable — the planted copy wins the search order.

**Headless approach.** All the needed structure is in the Mach-O load commands:

- `otool -l <binary>` → `LC_LOAD_DYLIB`, `LC_LOAD_WEAK_DYLIB`, `LC_RPATH`, `LC_REEXPORT_DYLIB`.
- Resolve `@rpath`, `@loader_path`, `@executable_path` exactly as dyld does, walking rpaths in
  order; check existence and writability of each candidate dir.
- Handle universal binaries with `otool -arch <arch>` (or `lipo` first).
- Enumerate apps under `/Applications` (or scan a single path).

**Crucial modern nuance — and a reason this tool is more valuable, not less.** macOS **hardened
runtime + library validation** means many classic hijacks no longer load (only same-Team-ID or
platform dylibs are accepted). So a naive scanner produces false positives. This tool should
reuse the signing helper (#1) to report, per finding, whether the target has hardened runtime /
library validation — and downgrade findings that those mitigations neutralize. That cross-check
is exactly where a fresh implementation can be *better* than a checkbox port.

**Proposed tool**

```
dhs_scan
  input:  { path?: string,            // single app/binary; default: scan /Applications
            apps_dir?: string,
            only_vulnerable?: bool = true }
  output: {
    scanned_count,
    results: [ {
      app, binary,
      hardened_runtime: bool, library_validation: bool,
      findings: [ {
        type: "weak"|"rpath",
        imported_dylib, resolved_path,
        reason,                       // e.g. "weak dylib absent", "earlier rpath writable"
        writable_dir: string|null,
        likely_exploitable: bool      // false if mitigations apply
      } ]
    } ]
  }
```

**Effort:** ~3–5 days. The Mach-O / dyld search-order emulation (rpath resolution, fat binaries,
nested frameworks) is the real work; the I/O is easy.

**Caveats:** correctness of dyld emulation is the whole game — worth a fixture set of known-good
and known-vulnerable binaries to test against. Scanning all of `/Applications` is slow; support
single-path mode and cap/paginate results. `readOnlyHint: true`.

---

## How they slot into the existing server

- New module `src/tools/inspect.ts` registering the three tools, plus a shared
  `src/services/signing.ts` helper (used by all three).
- They're **data tools** like the snapshot scanners — read-only, no sudo for #1/#3, optional sudo
  for #2.
- In `constants.ts`, the corresponding GUI entries (`whatsyoursign`, `kextviewr`, `dhs`) keep
  their launch/status registration and gain a note pointing at the headless equivalent.
- Build/test fits the existing pipeline; add a small fixtures dir for `dhs_scan`.

## Suggested order & rough timeline

1. **WhatsYourSign** (foundation, ~1–2 d) — unlocks the signing helper.
2. **KextViewr** (~1–3 d) — thin layer over `kmutil` + the helper.
3. **DHS** (~3–5 d) — the substantive one; reuses the helper to cut false positives.

## Open questions for you

- Scope of `dhs_scan` by default: just `/Applications`, or also `~/Applications` and running
  processes' executables?
- For `whatsyoursign_check`, do you want disk-image (`.dmg`) and `.pkg` handling in v1, or
  Mach-O/app-only first?
- Do you want these as separate tools (proposed) or folded into one `os_inspect` tool with a
  `mode` argument? Separate tools are clearer for the agent; one tool is tidier.
