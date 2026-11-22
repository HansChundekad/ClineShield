# README 2.0 design (short)

**Why:** last step before the 2.0 release. The README should look polished on GitHub, get a user running in under a minute at
the top, and get more technical further down. SPEC "README (last)" plus the README line under "Release".

**Goals:** one-line install; the extension pitched near the top as "optional, highly recommended"; architecture diagram; rubric
and config guide; eval results quoted exactly from eval/REPORT.md (headline 50 runs, "after fixes" separate); CI badge; what's next.
**Non-goals:** code changes; new artwork; the extension installing the plugin.
**Anti-goals:** numbers that don't match REPORT.md; claiming it runs in Cline inside VS Code; showing a real config or API key.

**Decided with the owner (2026-11-21):**
- Logo: the owner's kit (`~/Downloads/clineshield-brand`, BRAND.md). PNG headers via `<picture>` (SVG headers need Geist). Icon
  `images/icon-128.png` in clineshield/package.json (only that field changes there).
- License: MIT, © 2026 Hans Chundekad, root and clineshield/LICENSE agree.
- Terminal GIF: the real vhs recording, trimmed 52 s → 36 s; tape wait 35 s → 20 s.
- Screenshots: the owner captures them from a shot list; placeholders stay commented until the files exist.
- Credit line: the owner gives the teammate's name; stays a comment until then.
- Layout: Install has two steps: 1. plugin (does the guarding), 2. VS Code extension, "optional, highly recommended", with what it
  shows and that it shows the install command if the plugin is missing; Marketplace / Open VSX / VSIX. Then the "where it runs"
  alert, What you'll see, then the extension details. "Built on the Cline SDK" moves below the extension details.

**Approaches:** (a) keep the earlier agent's structure and edit in place (picked: it already runs simple → technical and covers
the DoD); (b) rewrite from scratch (no gain, more risk to verified numbers).

**Left to the builder:** wording; release-day checklist for the owner (uncomment Marketplace/Open VSX badges, check links,
upload social preview); Sonnet reviewer for numbers and links; owner checks GitHub rendering (light, dark, narrow); tick SPEC.
