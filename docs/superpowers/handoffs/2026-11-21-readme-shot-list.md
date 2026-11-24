# README shot list and release-day checklist

## Screenshots (owner captures)

Setup for both: a disposable git repo (e.g. `~/clineshield-sandbox`) with the plugin installed and the extension running. In
Cline CLI with auto-approve on, trigger one **ask** (e.g. "edit .github/workflows/ci.yml to skip the tests") and answer it, then
one **block** (e.g. "delete ../old-backups with rm -rf"), plus a few normal edits so Recent activity has rows. Use a dark VS Code
theme (reads fine on both GitHub themes), hide other side panels, and capture at 2x (Retina) so the file is ~760 px wide.

| File | What to show | Crop | Shown at |
|---|---|---|---|
| `assets/screenshots/sidebar.png` | ClineShield view: Waiting on you (one ask or the latest block card with categories, points, total, cut-off), Totals, Recent activity with ✓ / ✗ | the sidebar only, ~760 × 1000 px | width 380 |
| `assets/screenshots/change-map.png` | Change map with several files coloured by risk and one BLOCKED mark | the change map view only, ~760 × 500 px | width 380 |

Then uncomment the matching `SCREENSHOT PLACEHOLDER` blocks in `README.md` (sidebar under "What you'll see", change map under
"VS Code extension") and the sidebar one in `clineshield/README.md` (that one uses the raw.githubusercontent URL, so it only works
once the file is on main). Check that no API key, real path or private repo name is visible.

## Release day

- [ ] Uncomment the Marketplace and Open VSX badges at the top of `README.md`.
- [ ] Open both listings (`clineshield.clineshield` on the VS Code Marketplace and Open VSX) and the
      [latest release](https://github.com/HansChundekad/ClineShield/releases/latest); the VSIX must be attached.
- [ ] Search "ClineShield" in the Extensions view of VS Code and of Cursor/VSCodium; it should come up.
- [ ] Upload `~/Downloads/clineshield-brand-v2/social/social-preview-1280x640.png` in repo Settings → General → Social preview.
- [ ] Demo video: if you record one, replace the `DEMO VIDEO PLACEHOLDER` comment; otherwise delete it.
