# Dalko Insights (Web)

Browser-based freight analytics for TMS Excel dumps. All processing happens **locally** in your browser—the file is never uploaded.

## Run locally

ES modules require a local web server (opening `index.html` directly may block module loading).

Double-click `run-server.bat`, or from this folder:

```powershell
python -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

## Project layout

```
HTML Version/
  index.html                 # Hub shell + portal chooser
  run-server.bat
  shared/                    # Cross-portal shell (theme, router, dialogs)
    css/shell.css
    js/shell.js
    js/router.js
    js/dialog.js
    images/
  portals/
    dalko/                   # Dalko Portal — sales analytics dashboard
      css/portal.css
      js/mount.js            # Portal entry (mount / unmount)
      js/app.js
      js/analytics/
      js/data/
      js/ui/
      js/workers/
    customer/                # Customer Portal module
      css/portal.css
      js/mount.js
    glassbox/                # Glass Box module
      css/portal.css
      js/mount.js
      js/app.js
      js/catalog.js
      js/tool-loader.js      # dynamic Scripts launcher
      Scripts/               # tools (same layout as Python Glass Box)
        _shared/tool-shell.js
        Accounting/
        Tracking Apps/
        Data Tools/
        Client Reports/
        Client Uploads/
        Data Dept. Apps/Ops Apps/
      images/
```

Each portal is self-contained: put that portal’s UI, styles, and logic under its folder. The shell loads a portal through `mount.js` (`mount` / `unmount`).

## Deploy to GitHub Pages

1. Push the contents of `HTML Version/` to a repo (or a `/docs` folder).
2. In GitHub → Settings → Pages, set source to that branch/folder.
3. Share the `github.io` link with your team.

## Usage

1. Open portals from the hub and choose **Dalko Portal**.
2. **Upload file** — TMS data dump (`.xlsx` / `.xls`).
3. Analysis runs automatically in a background worker (UI stays responsive).
4. **Filters** — date range; click any table row to **focus**; **Clear focus** resets.
5. **Export CSV** — on every detail tab.

### Large files

- Soft warning above ~35 MB / ~80k rows (you can continue).
- Hard stop above ~120 MB / ~300k rows (narrow the TMS export).
- Parse and analyze run off the UI thread; if a worker fails, the app falls back to the main thread.
