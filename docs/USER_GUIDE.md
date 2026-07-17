# SLA Dashboard — User Guide

This guide covers everyday use of the SLA Dashboard for both regular users and administrators. It assumes the dashboard is already deployed and reachable at your organisation's URL.

---

## 1. Getting Started

### Requesting access

The dashboard does not have open signup — access is tied to your staff record.

1. Open the dashboard login page.
2. Click **Request access →**.
3. Enter the email address and password you want to use, then submit.
4. Your account is created with standard (viewer) access right away — go back to the login screen and log in with the email and password you just chose.

Your account is matched to your organisation's staff record by email address, so use the same email your organisation has on file for you — signup will fail if no matching active staff record exists. (Note: the confirmation message shown on screen currently says your account needs admin approval — you can ignore that and log in immediately.)

### Logging in

1. Enter your email and password.
2. Click **Login**.

If your account hasn't been approved yet, or your password is wrong, an error message appears above the form.

### Forgot your password?

1. Click **Lost password →**.
2. Enter your registered email and click **Get reset code**.
3. You'll be shown a reset code and moved to the "Set new password" screen.
4. Paste the reset code, enter a new password (minimum 6 characters) twice to confirm, and click **Set new password**.
5. Log in with your new password.

The reset code expires after 1 hour.

### Signing out

Click the sign-out icon (top-right of the header) at any time. This clears your session; you'll need to log in again to return to the dashboard.

Sessions also expire automatically after 8 hours — if this happens mid-use, you'll be returned to the login screen and need to log in again.

---

## 2. The Dashboard (Home View)

After logging in you land on the main **Dashboard** view. It refreshes automatically (every 5 minutes by default, or whatever interval an admin has configured) and shows a "Last refresh" timestamp in the header along with the data's reporting date.

### Loan summary strip
Three cards across the top show today's loan milestones:

| Card | What it shows |
|---|---|
| Application Received | Count and total loan amount of applications received today, vs. yesterday |
| Funder Approvals | Count and total amount of funder approvals today, vs. yesterday |
| Settlements | Count and total amount of settlements today, vs. yesterday |

Each card has a configurable target badge (top-right) and can be clicked to drill into the individual loans behind that number.

### KPI strip
Four tiles summarise performance across all currently visible teams:

| Tile | Meaning |
|---|---|
| Total Active Tasks | Open tasks created today |
| Overall SLA % | Percentage of today's completed tasks that met their SLA target |
| Avg Turnaround | Average time tasks spend open, shown as h:mm:ss |
| Overdue / Breached | Open tasks that have exceeded their SLA target, plus completed tasks that breached it |

Hover the ⓘ icon on any tile for a plain-English explanation of exactly what it counts and how it's calculated — this also tells you whether the value depends on a setting an admin controls.

Small arrows show the change vs. yesterday. For most metrics, red = getting worse and green = getting better; for Volume, the change is shown in neutral grey since more or fewer tasks isn't inherently good or bad.

### Team Performance cards
Below the KPI strip, one card per team (teams are discovered automatically from your organisation's task data, not manually configured) shows that team's Volume, SLA %, Avg TAT, and Overdue count. Click a card to open a drill-down list of that team's tasks today.

### 7-Day SLA Compliance Trend
A line chart showing each team's SLA % over the last 7 business days (weekends excluded). Click a team name in the legend to show or hide its line — useful when comparing just a couple of teams.

### Active Alerts panel
Lists tasks that are at risk of breaching, or have already breached, their SLA target, grouped by severity (Critical / Warning). You can dismiss an alert from view; dismissing doesn't change the underlying data, only what's shown on your screen.

---

## 3. Other Views

Navigate between views using the icons in the left sidebar.

### Teams
A sortable table of every team with the same four metrics as the dashboard cards, for a side-by-side comparison. Click a row to open the same drill-down as clicking a dashboard card.

### Tasks
The full list of active tasks across all teams, with filters by team and status. Each row shows Task ID, App ID, creation date, SLA-adjusted date, description, current status, team, time-against-target, and priority.

### Reports
A historical SLA trend chart with a date-range selector, so you can look further back than the dashboard's rolling 7 days (e.g. by month). Use the legend the same way as the dashboard trend chart to isolate specific teams.

### Alerts
The full-page version of the Active Alerts panel — every current alert, with the same drill-down behaviour as the dashboard panel.

### Staff List
Available to everyone (not admin-only). Shows:
- **Absent Today** — staff currently marked absent, with their department, work-status, and start/end times.
- **All Departments** — every department with its active staff count. Use the search box to filter by department name. Click a department row to see the individual active staff members in it.

---

## 4. Understanding the Numbers

A few things that are easy to misread at a glance:

- **"Today" is the dashboard's reporting date**, shown next to the last-refresh time in the header — this is normally today's date, but if your organisation is working from a data snapshot it may reflect the latest date actually present in that snapshot.
- **SLA % only counts completed tasks.** A team with very few completed tasks today can show a volatile SLA % — check the Volume figure alongside it before drawing conclusions.
- **Avg Turnaround blends open and closed tasks** using elapsed time for open tasks and actual completion time for closed ones — it is a live, moving number for any team with open work.
- **A team card can disappear or reappear** if an admin changes team visibility or SLA target grouping in Settings — this is expected, not a bug.
- Every metric's ⓘ tooltip states whether that number is affected by admin-configured Settings, so when in doubt, check the tooltip first.

---

## 5. Administrator Features

The following are only visible to accounts with the `admin` role. If you don't see these sidebar icons but believe you should have admin access, ask an existing administrator to grant it (§5.3 covers how administrators manage other users, but role changes themselves are done directly against staff records — contact your technical administrator).

### 5.1 Settings

Controls apply globally — one configuration for the whole organisation, not per-user.

- **Loan Targets** — set the daily target count for Application Received, Funder Approvals, and Settlements (shown as the badge on each loan card).
- **Team order and SLA target** — drag rows to reorder how teams appear across the dashboard, charts, and tables; set each team's SLA target hours. Click **REMOVE** next to a team to hide it everywhere (cards, charts, tables, alerts) — it moves to a **Hidden Teams** section below, where you can **Restore** it at any time.
- **Refresh & Thresholds** — set the auto-refresh interval, the "At Risk" percentage threshold (how close to the SLA target counts as at-risk, default 87.5%), and how many tasks a drill-down modal shows at once.

Click **Apply Changes** to save — changes take effect immediately across the whole dashboard for all logged-in users (within their next refresh cycle), no page reload needed. **Reset** reverts everything to defaults (all teams visible, no custom targets or ordering).

### 5.2 Task Codes List

A read-only, always-fresh (never cached) list of every configured task code, its function/queue, SLA hours, and whether it's tagged to a KPI group (and which group). Use the free-text filters at the top to search by task code, task name, or KPI group. This is the view to check when a team card seems to be missing tasks you expect it to include — it shows exactly which task codes feed which team.

### 5.3 User Management

A list of registered dashboard accounts — email, role, date joined, and status. New signups appear here as **approved** immediately (accounts are granted access automatically when created, regardless of the "pending approval" message shown on the signup screen). From here an administrator can remove a user's access entirely, which is currently the main lever available for controlling who can use the dashboard — there is no separate "reject" or role-change control in this view.

---

## 6. Troubleshooting (User-Facing)

| What you see | What it means | What to do |
|---|---|---|
| "Sorry, You Must Log In First!" | You're not logged in, or your session expired | Log in again |
| "Session expired — please log in again" | Your 8-hour token expired | Log in again — no need to contact anyone |
| "Too many attempts. Please try again in 15 minutes." | Too many failed login attempts from your network | Wait 15 minutes, then try again |
| "Signup successful! Your account is pending admin approval." | Your account has actually been created and given access already — this message is misleading (see note in §1) | Go back and log in right away |
| "Backend not reachable" / "Could not connect to backend" on login | The dashboard's server is temporarily down | Wait a few minutes and click **Retry**; if it persists, contact your technical administrator |
| A team card you expect to see is missing | It may have been hidden in Settings, or has no matching tasks today | Ask an admin to check Settings → Hidden Teams, or check Task Codes List for that team's configuration |
| Numbers look "stuck" / not updating | Waiting for the next auto-refresh cycle | Check the "Last refresh" timestamp; refreshes happen automatically every few minutes |

For anything not covered here, or for technical/deployment issues, see `docs/TECHNICAL_DOCUMENTATION.md` or `docs/DEPLOYMENT.md`.
