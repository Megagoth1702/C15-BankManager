# Local Live pack

The GitHub Pages site is **HTTPS**. Browsers block plain `ws://` to the C15 from that origin (mixed content). The **Local Live pack** runs the same app on `http://127.0.0.1` so Live mode works.

## For users

1. Open [Releases (latest)](https://github.com/Megagoth1702/C15-OfflinePresetManager/releases/latest).
2. Download **`C15-OPM-local.zip`**.
3. Unzip anywhere.
4. Double-click:
   - **Windows:** `Start.bat`
   - **macOS:** `Start.command` (if blocked: right-click → Open, or `xattr -cr` the folder)
   - **Linux:** `./Start.sh`
5. First run downloads official **Node.js** (pinned) from nodejs.org into `runtime/` (~30–40 MB). Needs internet once.
6. Browser opens → use **Offline/Live** → enter C15 IP → **Connect**.

**Leave the console window open** while using the app. **Close the window** (or Ctrl+C) to stop the server. Starting again also stops any previous server from this pack folder.

Updates are checked automatically on Start (from GitHub Releases). Skip with `OPM_SKIP_UPDATE=1`.

Offline editing still works on the website without this pack.

---

## For you (maintainer): fully automatic path

Ideal loop:

```text
Workbench → npm run publish:export → commit/push publishing/ main
                │
                ├─► Actions: Deploy GitHub Pages  (website)
                └─► Actions: Release Local Live pack  (zip on Releases)
```

You do **not** need to build the zip or click “Draft a new release” by hand once the workflow is on the public repo.

### What the workflow does

File: `.github/workflows/release-local-pack.yml` (exported from `scripts/templates/release-local-pack.yml`).

On every **push to `main`** (and **Run workflow**):

1. `npm ci`
2. `npm run pack:local` → `release-artifacts/C15-OPM-local.zip`
3. Reads `version` from `package.json`
4. Creates or **updates** GitHub Release tag **`v{version}`** with asset **`C15-OPM-local.zip`**
5. Marks it as **latest** so auto-update and `/releases/latest` work

### Version bumps

| Goal | Action |
|------|--------|
| Ship code/UI fix, same release number | Push `main` only — workflow **refreshes assets** on the same `vX.Y.Z` tag |
| New version for users / auto-update | Bump `"version"` in `package.json` (e.g. `0.2.0` → `0.2.1`), then push |

Auto-update compares semver: users only download when remote version **>** their local `app/version.json`.

### First-time setup on the public repo

1. Export and push so both workflows exist:

   ```powershell
   npm run publish:export
   cd publishing
   git add .
   git commit -m "Add Local Live pack + automated release workflow"
   git push origin main
   ```

2. GitHub → **Actions** → confirm two workflows:
   - **Deploy GitHub Pages**
   - **Release Local Live pack**

3. After green runs: **Releases** should show `v0.2.0` (or your version) with `C15-OPM-local.zip`.

No special secrets: `GITHUB_TOKEN` is enough for releases in the same repo.

### Manual / local pack (optional)

```powershell
npm run pack:local
```

Smoke-test: `release-artifacts/C15-OPM-local/Start.bat`

### Auto-update details

- On Start, launcher calls GitHub API `…/releases/latest`.
- If remote version > local, downloads asset **`C15-OPM-local.zip`**, replaces `app/` + `launcher/` + Start scripts, keeps `runtime/`.
- Failures go to `launcher.log`; app still starts.

### Process lifecycle (server stop)

- Console is the process host: close window / Ctrl+C → server stops.
- `launcher.pid` records the running PID; next Start kills a stale instance and frees port `17815` if needed.
- Do not start the pack with `start /b` or background job runners if you want close-window-to-stop behavior.

### Dev notes

| Script / path | Role |
|---------------|------|
| `npm run build` | Pages base `/C15-OfflinePresetManager/` |
| `npm run pack:local` | `VITE_BASE=./` build + zip |
| `local-pack/launcher/*` | server, bootstrap, update, Node ensure, PID lifecycle |
| `OPM_SKIP_UPDATE=1` | skip release check |
| `OPM_PORT` | override default port `17815` |

Do not commit `release-artifacts/`, `runtime/` with Node binaries, `launcher.log`, or `launcher.pid`.
