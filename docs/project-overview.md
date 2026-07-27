# SLA Dashboard — Project Overview

**Last updated:** 2026-07-27

---

## Purpose

Real-time web dashboard for **Mortgage Ezy Pty Ltd** showing how quickly each loan-processing team completes tasks against their SLA (Service Level Agreement) targets.

Staff and management can see at a glance:
- How many tasks are active, overdue, or at risk across all teams
- Each team's SLA compliance % for the day
- Trend charts over 7 days and longer history ranges
- Loan pipeline counts (received, approved, settled)
- Staff presence and department headcounts

---

## Users

| Role | Description |
|------|-------------|
| **Viewer** | Read-only access to all dashboard data |
| **Admin** | Can manage users, configure SLA targets per team, control team order/visibility, set at-risk thresholds and loan targets |

Admin account is auto-seeded on first backend start (`Staff.FirstName = 'System'` → password `@dmin`).

---

## Live URLs

| Layer | URL |
|-------|-----|
| Frontend (production) | `https://sla.mezy.com.au` / `https://sla-dashboard.vercel.app` |
| Backend (Railway) | `https://<railway-service>.up.railway.app` |
| Local dev — frontend | `http://localhost:5173` |
| Local dev — backend | `http://localhost:5000` |

---

## Views

| View | Description |
|------|-------------|
| Dashboard | Loan strip · KPI tiles · Team cards · 7-day trend · Alerts panel |
| All Teams | Table of all teams sorted by SLA% |
| All Active Tasks | Full task list with filters |
| Reports | Historical SLA compliance chart with date-range selector |
| Active Alerts | Alert feed with per-team drill-through |
| Settings | Per-team SLA targets, at-risk threshold, team order/visibility, loan targets |
| Staff List | Departments + absent-today; click row → staff modal |
| User Management | Admin only — registered users list with Remove action |

---

## Key Metrics Explained

| Metric | Definition |
|--------|-----------|
| **Volume** | All currently active tasks (no date filter) |
| **SLA %** | Completed tasks today (scoped by `SLAAdjustedDate`) that met their deadline |
| **Avg TAT** | Average `TotalHoursOnTask` for all active tasks (null/0 excluded) |
| **Overdue** | Active tasks where TAT > SLAInHours, TAT > team target, OR `GETDATE() > SLAAdjustedDate` |
| **At Risk** | Active tasks ≥ 87.5% (configurable) of SLA elapsed, not yet overdue |
