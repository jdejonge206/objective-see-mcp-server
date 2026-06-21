# How GitHub surfaces repo files (pills, community files, and linking)

A short reference for the thing you noticed: the row of links above the README, what GitHub
recognizes automatically, and how to surface anything else (like a roadmap) yourself.

## The row above the README ("community profile")

The pills above your rendered README aren't arbitrary — GitHub recognizes a **fixed set of
special files by name** and shows a pill for each one it finds. There is no general "any file
gets a pill" mechanism, and there is **no Roadmap pill**. The ones that can appear:

| Pill | File that triggers it |
|------|------------------------|
| README | `README` / `README.md` |
| License (e.g. "MIT license") | `LICENSE` / `LICENSE.md` / `COPYING` |
| Code of conduct | `CODE_OF_CONDUCT.md` |
| Security policy | `SECURITY.md` |
| Cite this repository | `CITATION.cff` |
| Activity / Stars / etc. | automatic, not file-based |

Other recognized "community health" files (`CONTRIBUTING.md`, `SUPPORT.md`, `FUNDING.yml`,
issue/PR templates) **don't** get a README pill — they surface elsewhere (the issue/PR
composer, a Sponsor button, etc.). So you can't make a roadmap into a pill by renaming it
`SUPPORT.md`; you'd just mislabel it, and it still wouldn't appear up top.

## Where GitHub looks, and precedence

For most special files, GitHub checks **three locations** and uses the first it finds, in this
order:

1. `.github/`
2. repository root
3. `docs/`

So `.github/CONTRIBUTING.md` wins over a root `CONTRIBUTING.md`. The README itself follows the
same `.github` → root → `docs` precedence.

**Two important exceptions:**

- **License must be in the root.** GitHub only detects the license (the pill + the API
  `license` field) when `LICENSE` is at the repository root. It also reads the *content*: the file
  is run through the **Licensee** library to identify *which* license, which is why the pill says
  "MIT license" rather than just "License." You can't provide a license via an org-wide default
  file — it must live in each repo so it travels with clones/downloads.
- **`FUNDING.yml` must be in `.github/`.**

## Organization-wide defaults (the special `.github` repo)

If you create a **public repo literally named `.github`** under your user/org, files you put in
its `.github/` (or root/`docs`) act as **defaults for every repo** in that account that lacks its
own copy. Great for applying one `CODE_OF_CONDUCT.md` or `SECURITY.md` across many repos. The
exception above still holds: **licenses can't be defaulted this way.**

## Surfacing anything else (roadmaps, architecture, design docs)

Since there's no pill for these, the convention is just two steps:

1. **Commit the file** somewhere sensible — `ROADMAP.md` in the root or `docs/`.
2. **Link to it from the README**, usually near the top. That link is what people actually click.

Use a **relative** link so it works on the default branch, in forks, and in clones:

```markdown
📍 **Roadmap:** see [docs/ROADMAP.md](docs/ROADMAP.md) for planned work.
```

Relative links (`docs/ROADMAP.md`, `../LICENSE`) are preferred over absolute
`https://github.com/...` URLs because they don't break across branches or forks. GitHub resolves
them relative to the file the link lives in.

A few linking niceties:

- **Heading anchors:** every Markdown heading gets an auto-anchor (lowercased, spaces → hyphens,
  punctuation dropped). Link to a section with `[text](#section-name)` or across files with
  `docs/ROADMAP.md#workstream-a`.
- **A table of contents / nav row** at the top of a README is just regular Markdown links —
  there's no special GitHub feature; you're replicating the "pill" look manually, e.g.
  `[Roadmap](docs/ROADMAP.md) · [Design](DESIGN.md) · [License](LICENSE)`.
- **Relative links can point at folders** (`[docs](docs/)`) to land on that directory listing.

## Quick "how do I add X" cheatsheet

- **Roadmap / design / architecture link** → commit the `.md`, add a relative link in README. *(No pill.)*
- **Security policy pill** → add `SECURITY.md` (root or `.github/`).
- **Code of conduct pill** → add `CODE_OF_CONDUCT.md`.
- **"Cite this repository" button** → add `CITATION.cff`.
- **Contributing guidelines** → add `CONTRIBUTING.md` (shows in the issue/PR composer, no pill).
- **Sponsor button** → add `.github/FUNDING.yml`.
- **License pill with a detected name** → put `LICENSE` in the **root**.

---

### Sources
- [About community profiles for public repositories](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)
- [Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
- [Licensing a repository](https://docs.github.com/articles/licensing-a-repository)
- [About the repository README file](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [Adding a security policy to your repository](https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository)
- [GitHub special files and paths (reference list)](https://github.com/joelparkerhenderson/github-special-files-and-paths)
