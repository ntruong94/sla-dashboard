# SLA Dashboard — Production Deployment Guide

> **Architecture summary**
>
> | Layer | Where it runs | URL |
> |-------|--------------|-----|
> | Frontend (React + Vite) | **Vercel** (auto-deploys on `git push`) | `https://sla.mezy.com.au` / `https://sla-dashboard.vercel.app` |
> | Backend (Node + Express) | **Your local PC** — exposed via **ngrok static domain** | `https://balmy-accurate-handpick.ngrok-free.app` |
> | Database (SQL Server) | **Your local PC** (`MySEReport`) | reachable only from `localhost` — never the internet |
>
> **Why the backend stays local:** SQL Server (`MySEReport`) is on the same machine. Migrating the DB to the cloud is a separate project. The ngrok static domain provides a stable public HTTPS URL that does NOT change on restart (unlike the old trycloudflare random URLs).

---

## 1. Architecture diagram

```
[Browser — users anywhere]
        │  HTTPS  (Vercel CDN)
        ▼
[Vercel — frontend static build]
        │  HTTPS API calls to VITE_API_BASE
        ▼
[ngrok static tunnel — balmy-accurate-handpick.ngrok-free.app]
        │  localhost:5000
        ▼
[Node.js backend — server.js  (your PC)]
        │  TCP 1433 (localhost only)
        ▼
[SQL Server — MySEReport  (your PC)]
```

---

## 2. Daily startup — keep the backend live

Every workday, run these two commands on your PC before users arrive.

### Step 1 — Start the backend
```powershell
cd "C:\Users\Ngoc\OneDrive - MORTGAGE EZY PTY LTD\Project_VibeCoding\SLA Dashboard\backend"
node server.js
```
Wait for:
```
SLA Dashboard backend running on port 5000 — mode: LIVE DATABASE
Connected to SQL Server
```

### Step 2 — Start the ngrok static tunnel
```powershell
& "$env:USERPROFILE\cloudflared.exe" tunnel --url http://localhost:5000
# — OR — if using ngrok:
& "$env:USERPROFILE\ngrok.exe" http --domain=balmy-accurate-handpick.ngrok-free.app 5000
```
> The ngrok free static domain (`balmy-accurate-handpick.ngrok-free.app`) does not change as long as you use the same ngrok account.
> Cloudflare Named Tunnels (see Section 7) are the permanent alternative — they restart automatically as a Windows service.

### Step 3 — Open the dashboard
`https://sla.mezy.com.au` (or `https://sla-dashboard.vercel.app`)

---

## 3. Frontend deployment (Vercel) — one-time setup

This is **already configured** (`origin/main` → Vercel auto-deploy).
Re-do only if you need to set it up from scratch.

1. Log into [vercel.com](https://vercel.com) → Import project from GitHub (`ntruong94/sla-dashboard`).
2. **Root directory:** `frontend`
3. **Build command:** `npm run build` (auto-detected)
4. **Output directory:** `dist` (auto-detected)
5. Add Environment Variable:
   - **Name:** `VITE_API_BASE`
   - **Value:** `https://balmy-accurate-handpick.ngrok-free.app`
   - **Environment:** Production (+ Preview if desired)
6. Add custom domain: `sla.mezy.com.au` → point DNS CNAME to `cname.vercel-dns.com`.
7. Vercel auto-enables HTTPS via Let's Encrypt.

> Every `git push` to `main` triggers a new Vercel build automatically.

---

## 4. Backend environment variables (local `.env`)

The backend reads all secrets from `backend/.env` (never committed to git).
See `backend/.env.example` for the full list of keys.

Critical variables:

| Variable | Purpose | Example format |
|----------|---------|----------------|
| `DB_SERVER` | SQL Server host | `localhost` |
| `DB_PORT` | SQL Server port | `1433` |
| `DB_DATABASE` | Database name | *(set in .env — not here)* |
| `DB_USER` | SQL login username | *(set in .env — not here)* |
| `DB_PASSWORD` | SQL login password | *(set in .env — not here)* |
| `JWT_SECRET` | JWT signing key (≥32 chars) | *(set in .env — not here)* |
| `ALLOWED_ORIGINS` | Comma-separated frontend URLs | `https://sla.mezy.com.au,...` |
| `NODE_ENV` | `development` or `production` | `production` on live server |
| `PORT` | Listening port | `5000` |

**Generate a new JWT_SECRET:**
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 5. Vercel environment variables (production frontend)

Set in Vercel dashboard → Project → Settings → Environment Variables:

| Variable | Value |
|----------|-------|
| `VITE_API_BASE` | The full backend tunnel URL (no trailing slash) |

> When the ngrok tunnel URL changes (only if you close the old tunnel and open a new one), update this value in Vercel and redeploy (or just push any trivial commit to trigger a rebuild).

---

## 6. Security hardening applied (2026-06-15)

All changes are in `backend/server.js`. No breaking changes to dashboard behaviour.

| Hardening measure | Detail |
|------------------|--------|
| **`helmet`** | Sets HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc. on every response |
| **`express-rate-limit`** | 10 attempts / 15 min per IP on all 4 auth endpoints (`/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password`) |
| **`trust proxy 1`** | Ensures rate limiter sees the real client IP, not the Vercel/ngrok proxy IP |
| **Sanitized errors** | All 19 `res.status(500).json({ error: err.message })` calls replaced with `sendError()` helper — returns generic message in production, actual error in dev |
| **Fail-fast JWT_SECRET** | Server exits at startup if `JWT_SECRET` is missing or < 32 chars (was previously silently using a weak fallback) |
| **Env-driven CORS** | `ALLOWED_ORIGINS` env var overrides hardcoded list — add new frontend URLs without code changes |

---

## 7. Upgrading to a Cloudflare Named Tunnel (recommended for 24/7 uptime)

A Cloudflare Named Tunnel runs as a **Windows service** — it starts automatically when your PC boots and reconnects after network interruptions. No terminal window needed.

### Prerequisites
- Domain (`mezy.com.au` or similar) added to your Cloudflare account
- `cloudflared.exe` installed on your PC

### One-time setup
```powershell
# 1. Authenticate cloudflared with your Cloudflare account
& "$env:USERPROFILE\cloudflared.exe" login

# 2. Create a named tunnel (do this once)
& "$env:USERPROFILE\cloudflared.exe" tunnel create sla-backend

# 3. Create the config file at %USERPROFILE%\.cloudflared\config.yml:
#    tunnel: <TUNNEL-ID-FROM-STEP-2>
#    credentials-file: C:\Users\Ngoc\.cloudflared\<TUNNEL-ID>.json
#    ingress:
#      - hostname: api.sla.mezy.com.au
#        service: http://localhost:5000
#      - service: http_status:404

# 4. Add DNS record (routes api.sla.mezy.com.au → tunnel)
& "$env:USERPROFILE\cloudflared.exe" tunnel route dns sla-backend api.sla.mezy.com.au

# 5. Install as a Windows service (auto-starts on boot)
& "$env:USERPROFILE\cloudflared.exe" service install

# 6. Update Vercel env var: VITE_API_BASE=https://api.sla.mezy.com.au
# 7. Update backend ALLOWED_ORIGINS in .env to include https://sla.mezy.com.au
```

After this, users access `https://sla.mezy.com.au` (frontend on Vercel) which calls `https://api.sla.mezy.com.au` (backend via named tunnel) → which hits your local `localhost:5000` → SQL Server.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Could not connect to backend` in dashboard | Backend not running or tunnel dead | Run Steps 1–2 in Section 2 |
| `Session expired — please log in again` | JWT token expired (8h) | User logs in again — no restart needed |
| `Too many attempts. Please try again in 15 minutes.` | Rate limiter triggered (>10 login attempts) | Wait 15 min; check for credential-stuffing |
| Vercel build fails | Missing `VITE_API_BASE` env var | Set it in Vercel dashboard → Redeploy |
| `FATAL: JWT_SECRET environment variable is missing` | `JWT_SECRET` not in `.env` | Add it to `backend/.env` (see Section 4) |
| Backend starts but no DB data | SQL Server not running | Start SQL Server service on your PC |
| ngrok tunnel URL changed | Closed and reopened ngrok without `--domain` flag | Always use `--domain=balmy-accurate-handpick.ngrok-free.app` |

---

## 9. What is NOT deployed to the cloud

| Item | Why kept local |
|------|---------------|
| `backend/server.js` | SQL Server is on the same machine — moving it to the cloud would require DB migration |
| `backend/.env` | Contains credentials — must never be committed or uploaded |
| SQL Server (`MySEReport`) | Source-of-truth operational database — migration is a separate project |

---

## 10. Credential rotation checklist

If you suspect a secret has been exposed, rotate in this order:

1. **SQL Server password** — change via SQL Server Management Studio → update `DB_PASSWORD` in `backend/.env`
2. **JWT_SECRET** — generate new 64-char hex → update in `backend/.env` → all existing sessions will be invalidated (users must log in again)
3. **ngrok authtoken** — revoke at dashboard.ngrok.com → re-authenticate `ngrok config add-authtoken <new-token>`
4. **Vercel token** (if used in CI) — rotate at vercel.com → Account Settings → Tokens

> Never put actual secret values in this file, CLAUDE.md, commit messages, or chat messages.
