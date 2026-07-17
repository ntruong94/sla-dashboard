# SLA Dashboard — Deployment Guide

**Environment:** Windows Server with IIS  
**Stack:** React frontend (IIS) + Node.js/Express backend (PM2 process manager)  
**Paths:**
- Frontend: `E:\EZYOS\Webs\SLADashboard\frontend`
- Backend: `E:\EZYOS\Webs\SLADashboard\backend`
- Backend entry point: `server.js`
- Backend port: `5000`
- IIS port: `8088`

---

## Deploying New Code

### Step 1 — Stop the Backend Service

Open PowerShell:

```powershell
pm2 stop sla-backend
```

Verify it's stopped:

```powershell
pm2 list
```

The `sla-backend` entry should show status `stopped`.

---

### Step 2 — Deploy Backend Changes

Copy updated backend files to the server (replace or overwrite as needed):

```
E:\EZYOS\Webs\SLADashboard\backend\
```

If there are new npm packages, install them:

```powershell
cd E:\EZYOS\Webs\SLADashboard\backend
npm install --omit=dev
```

> **Important:** Do **not** run `npm install` as part of the service — always install manually before restarting.

If `.env` has new variables, update the file:

```
E:\EZYOS\Webs\SLADashboard\backend\.env
```

---

### Step 3 — Deploy Frontend Changes

Navigate into the `frontend` subfolder first, then install dependencies and build:

```powershell
cd E:\EZYOS\Webs\sla-dashboard222\frontend
npm install
npm run build
```

> **Note:** `npm install` is required to pull down Vite and all dependencies before the build. Skip it and the build will fail with `'vite' is not recognized`.

Copy the contents of the `dist/` (or `build/`) output folder to:

```
E:\EZYOS\Webs\SLADashboard\frontend\
```

> **Note:** Replace all files. Do **not** delete `web.config` — it contains the IIS reverse proxy rules and SPA fallback.

Verify `web.config` is still present after the copy:

```
E:\EZYOS\Webs\SLADashboard\frontend\web.config  ← must exist
```

---

### Step 4 — Restart the Backend Service

```powershell
pm2 restart sla-backend
```

Verify it's running:

```powershell
pm2 list
```

The `sla-backend` entry should show status `online`.

Save the PM2 process list so it survives a server reboot:

```powershell
pm2 save
```

---

### Step 5 — Verify the Deployment

1. Open a browser and navigate to `http://10.175.60.11:8088/`
2. Log in and confirm the dashboard loads correctly
3. Check the backend logs for any startup errors:

```powershell
pm2 logs sla-backend --lines 50
```

Or stream live:

```powershell
pm2 logs sla-backend
```

---

## IIS Configuration Reference

The `web.config` in the frontend folder must contain:

1. **API reverse proxy rule** — forwards `/api/*` to `http://127.0.0.1:5000`
2. **SPA fallback rule** — serves `index.html` for all non-file routes

Key IIS prerequisites (one-time setup, already done):
- URL Rewrite module installed
- Application Request Routing (ARR) installed and proxy enabled
- Server variables `HTTP_X_FORWARDED_FOR`, `HTTP_X_FORWARDED_HOST`, `HTTP_X_FORWARDED_PROTO` whitelisted via `appcmd.exe`

If `web.config` is lost or corrupt, see the **web.config Template** section below.

### web.config Template

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="API Reverse Proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:5000/api/{R:1}" />
        </rule>
        <rule name="SPA Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
    <staticContent>
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
    </staticContent>
  </system.webServer>
</configuration>
```

---

## PM2 Process Reference

| Action | Command |
|---|---|
| Stop backend | `pm2 stop sla-backend` |
| Start backend | `pm2 start sla-backend` |
| Restart backend | `pm2 restart sla-backend` |
| Check status | `pm2 list` |
| View live logs | `pm2 logs sla-backend` |
| View last N lines | `pm2 logs sla-backend --lines 50` |
| Save process list | `pm2 save` |
| Resurrect on reboot | `pm2 resurrect` |

---

## Troubleshooting

### Backend 500 errors after deploy

Check logs for startup failures:

```powershell
pm2 logs sla-backend --lines 50
```

Common causes:
- Missing or changed `.env` variable → update `.env` and restart: `pm2 restart sla-backend`
- New npm dependency not installed → run `npm install --omit=dev` then `pm2 restart sla-backend`
- SQL Server connection failed → verify DB is reachable and credentials are correct

### Frontend shows blank page / old version

- Hard-refresh the browser: `Ctrl + Shift + R`
- Confirm new `dist/` files were copied to `E:\EZYOS\Webs\SLADashboard\frontend\`
- Check that `web.config` is still present (not overwritten by the build)

### 404 on `/api/*` routes

IIS reverse proxy is not forwarding. Check:

1. Node backend is running: `pm2 list` → `sla-backend` should be `online`
2. `web.config` API rule is intact
3. ARR proxy is enabled: IIS Manager → Server → Application Request Routing Cache → Server Proxy Settings → Enable proxy ✓

### CORS errors in browser console

The request origin may not be in the backend's allowed origins list (`server.js` CORS config). Add the IIS host origin (e.g., `http://10.175.60.11:8088`) and restart:

```powershell
pm2 restart sla-backend
```

### Backend won't start

Check PM2 logs for the error:

```powershell
pm2 logs sla-backend --lines 100
```

Try starting manually to see raw output:

```powershell
cd E:\EZYOS\Webs\SLADashboard\backend
node server.js
```

Also check Windows Event Viewer → Application for additional error messages.
