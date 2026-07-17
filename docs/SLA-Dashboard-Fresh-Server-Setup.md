# SLA Dashboard — Fresh Server Setup Guide

**For:** New team members setting up the SLA Dashboard on a new Windows Server  
**Stack:** React frontend (IIS) + Node.js/Express backend (PM2)  
**Estimated time:** 45–60 minutes

---

## Prerequisites

Ensure the following are available before starting:

- Windows Server with IIS role installed
- Access to the codebase (source folder or zip)
- SQL Server instance with the SLA Dashboard database restored
- Network access to the SQL Server from this machine
- Administrator rights on the server

---

## Part 1 — Install Required Software

### 1.1 — Node.js

Download and install the LTS version from [https://nodejs.org](https://nodejs.org).

Verify installation:

```powershell
node -v
npm -v
```

### 1.2 — PM2 (Process Manager)

Install globally via npm:

```powershell
npm install -g pm2
```

Verify:

```powershell
pm2 -v
```

### 1.3 — IIS Modules

Install both modules on the server:

- **URL Rewrite** — https://www.iis.net/downloads/microsoft/url-rewrite
- **Application Request Routing (ARR)** — https://www.iis.net/downloads/microsoft/application-request-routing

After installing ARR, enable the proxy:

1. Open **IIS Manager**
2. Click the **server node** (top level, not the site)
3. Open **Application Request Routing Cache**
4. Click **Server Proxy Settings** in the right panel
5. Check **Enable proxy** → click **Apply**

### 1.4 — Whitelist IIS Server Variables

Run the following in PowerShell as Administrator (one-time setup):

```powershell
%windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_FOR']" /commit:apphost
%windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost
%windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_HOST']" /commit:apphost
```

---

## Part 2 — Deploy the Codebase

### 2.1 — Create the application folder

```powershell
mkdir E:\EZYOS\Webs\SLADashboard
mkdir E:\EZYOS\Webs\SLADashboard\frontend
mkdir E:\EZYOS\Webs\SLADashboard\backend
```

> You can use a different root path, just keep it consistent throughout this guide.

### 2.2 — Copy backend files

Copy the entire backend source to:

```
E:\EZYOS\Webs\SLADashboard\backend\
```

### 2.3 — Configure environment variables

Create the `.env` file in the backend folder:

```
E:\EZYOS\Webs\SLADashboard\backend\.env
```

Minimum required variables (get values from the team lead or existing server):

```env
NODE_ENV=production
PORT=5000
DB_SERVER=<sql-server-host>
DB_NAME=<database-name>
DB_USER=<db-username>
DB_PASSWORD=<db-password>
JWT_SECRET=<a-long-random-secret-string>
SLA_DASHBOARD_ID=<dashboard-id>
```

> **Important:** Never commit `.env` to source control.

### 2.4 — Install backend dependencies

```powershell
cd E:\EZYOS\Webs\SLADashboard\backend
npm install --omit=dev
```

### 2.5 — Test the backend manually

Before setting up PM2, verify the backend starts cleanly:

```powershell
node server.js
```

Expected output:
```
SLA Dashboard backend running on port 5000 — mode: LIVE DATABASE
Connected to SQL Server
[startup] auth tables verified ...
[cache] warming kpi...
[cache] kpi ready
```

If it starts without errors, press `Ctrl+C` to stop — PM2 will manage it from here.

---

## Part 3 — Build and Deploy the Frontend

### 3.1 — Build the React app

Navigate into the frontend source folder (on your dev machine or directly on the server if Node is available):

```powershell
cd <path-to-frontend-source>\frontend
npm install
npm run build
```

> `npm install` is required first — it installs Vite and all build dependencies. Skipping it will cause a `'vite' is not recognized` error.

This produces a `dist/` folder.

### 3.2 — Copy frontend build output

Copy the **contents** of `dist/` to:

```
E:\EZYOS\Webs\SLADashboard\frontend\
```

### 3.3 — Create web.config

Create the file `E:\EZYOS\Webs\SLADashboard\frontend\web.config` with the following content:

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

> **Do not** add a `<security>` block — IIS includes it globally and adding it causes a duplicate entry error (0x800700b7).

---

## Part 4 — Configure IIS Site

### 4.1 — Create the IIS site

1. Open **IIS Manager**
2. Right-click **Sites** → **Add Website**
3. Fill in:

| Field | Value |
|---|---|
| Site name | `SLADashboard` |
| Physical path | `E:\EZYOS\Webs\SLADashboard\frontend` |
| Binding type | `http` |
| Port | `8088` (or your chosen port) |
| IP address | `All Unassigned` |

4. Click **OK**

### 4.2 — Set IIS application pool

1. In IIS Manager, click **Application Pools**
2. Find the pool created for `SLADashboard`
3. Set **.NET CLR version** to `No Managed Code` (it's serving static files + proxying to Node)
4. Set **Managed pipeline mode** to `Integrated`

### 4.3 — Open Windows Firewall port

```powershell
New-NetFirewallRule -DisplayName "SLA Dashboard (8088)" -Direction Inbound -Protocol TCP -LocalPort 8088 -Action Allow
```

---

## Part 5 — Start the Backend with PM2

### 5.1 — Start the backend process

```powershell
cd E:\EZYOS\Webs\SLADashboard\backend
pm2 start server.js --name sla-backend
```

### 5.2 — Verify it's running

```powershell
pm2 list
```

The `sla-backend` entry should show status **online**.

Check the logs for any errors:

```powershell
pm2 logs sla-backend --lines 50
```

### 5.3 — Save and configure auto-start

Save the PM2 process list so it restores after a server reboot:

```powershell
pm2 save
```

To register PM2 itself as a Windows startup task:

```powershell
pm2 startup
```

Follow the instruction it prints (it will give you a command to run as Administrator).

---

## Part 6 — Verify the Full Stack

1. Open a browser and navigate to `http://<server-ip>:8088/`
2. The login page should appear
3. Log in with an existing account
4. Confirm the dashboard loads data correctly

---

## Part 7 — Database Setup (if fresh DB)

If this is a brand new database (not restored from an existing server), the backend will auto-create the required auth tables on first startup:

- `ConfigReportUsers`
- `ConfigDashboards`
- `DashboardAccess`

A default **system admin** account is also seeded automatically. Get the credentials from `server.js` or the `.env` file (look for `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

### Known issue — bcrypt login error

If users can't log in and the PM2 logs show:

```
Error: Illegal arguments: string, object
  at Object.compare (bcryptjs...)
```

This means the `PasswordHash` column in `ConfigReportUsers` is stored as `VARBINARY` instead of `NVARCHAR`. Fix it in the login query in `server.js` (around the `SELECT` in `POST /api/auth/login`):

```sql
-- Change this:
cru.PasswordHash

-- To this:
CAST(cru.PasswordHash AS NVARCHAR(MAX)) AS PasswordHash
```

Then restart:

```powershell
pm2 restart sla-backend
```

---

## Quick Reference — PM2 Commands

```powershell
pm2 list                        # show all processes and status
pm2 stop sla-backend            # stop the backend
pm2 start sla-backend           # start the backend
pm2 restart sla-backend         # restart the backend
pm2 logs sla-backend            # live log stream
pm2 logs sla-backend --lines 50 # last 50 lines
pm2 save                        # persist process list across reboots
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login page doesn't load | IIS site not started or firewall blocked | Check IIS Manager → site is Started; check firewall rule |
| 404 on `/api/*` routes | Backend not running or `web.config` missing | `pm2 list`; verify `web.config` exists with API rule |
| 502 Bad Gateway on `/api/*` | Backend down or not on port 5000 | `pm2 restart sla-backend`; check `.env` PORT value |
| `'vite' is not recognized` on build | `node_modules` missing | Run `npm install` before `npm run build` |
| bcrypt login error | `PasswordHash` column is VARBINARY | Cast to NVARCHAR in login query (see Part 7) |
| Blank page / old frontend | `dist/` not copied or browser cached | Re-copy files; hard-refresh `Ctrl+Shift+R` |
| CORS errors | IIS origin missing from allowed origins | Add server IP:port to CORS config in `server.js`; restart |
| `web.config` duplicate entry error (0x800700b7) | `<security>` block added manually | Remove the `<security>` block from `web.config` |
