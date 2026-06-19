# SLA Logic Audit — Full Queries with TODAY = 2026-05-28

**Generated:** 2026-06-17  
**TODAY:** 2026-05-28  
**Previous Business Day:** 2026-05-27  
**NOW_SQL (for open-task TAT):** CAST('2026-05-29' AS DATETIME)  
**Active TaskStatusID values:** 1, 4, 5, 6 (In Progress, On Hold, On Queue, Not Queued)  
**Completed TaskStatusID:** 2

---

## SQL Helpers & Constants

### TEAM_ID_CASE (SQL CASE expression — maps task to team ID 1–8)
```sql
CASE
  WHEN s.DepartmentId = 101 THEN 1
  WHEN s.DepartmentId = 110 THEN 2
  WHEN s.DepartmentId = 86  THEN 3
  WHEN s.DepartmentId = 122 THEN 4
  WHEN cls.Name LIKE N'%CLA%' THEN 5
  WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
  WHEN s.DepartmentId = 12  THEN 7
  WHEN s.DepartmentId = 10  THEN 8
END
```

### TEAM_NAME_CASE (SQL CASE expression — maps task to team name)
```sql
CASE
  WHEN s.DepartmentId = 101 THEN 'Data Entry'
  WHEN s.DepartmentId = 110 THEN 'Valuations'
  WHEN s.DepartmentId = 86  THEN 'Assessments'
  WHEN s.DepartmentId = 122 THEN 'Packaging & QA'
  WHEN cls.Name LIKE N'%CLA%' THEN 'CLA'
  WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 'Funder Submission'
  WHEN s.DepartmentId = 12  THEN 'Settlement'
  WHEN s.DepartmentId = 10  THEN 'Ezy Client Care'
END
```

### TEAM_FILTER (WHERE clause for all queries — filters to valid teams)
```sql
(
  (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
  OR cls.Name LIKE N'%CLA%'
  OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
)
```

### LOAN_STATUS_JOIN (LEFT JOINs required for teams 5 & 6)
```sql
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus       cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
```

### TAT Expressions
- **Open tasks (active):** `DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0`
- **Closed tasks (completed):** `DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0`

---

## 1. KPI Summary — `/api/kpi-summary`

### Query 1 — Main KPI Metrics (Volume, Avg TAT, Overdue — active & all tasks)
```sql
SELECT
  -- Total Active Tasks created TODAY
  SUM(CASE WHEN t.DateCreated >= '2026-05-28' AND t.DateCreated < '2026-05-29'
           AND t.TaskStatusID IN (1, 4, 5, 6) THEN 1 ELSE 0 END) AS totalTasks,
  -- Total Overdue (open tasks with TAT > SLA target)
  SUM(CASE WHEN t.DateCreated >= '2026-05-28' AND t.DateCreated < '2026-05-29'
           AND t.TaskStatusID IN (1, 4, 5, 6)
           AND (DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 > t.SLAInHours
                OR (t.SLAAdjustedDate IS NOT NULL AND CAST('2026-05-29' AS DATETIME) > t.SLAAdjustedDate))
           THEN 1 ELSE 0 END) AS totalOverdue,
  -- Avg TAT (open: GETDATE()-DateCreated; closed: DateCompleted-DateCreated)
  AVG(CASE WHEN t.DateCreated >= '2026-05-28' AND t.DateCreated < '2026-05-29'
           THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                     THEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0
                     ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END ELSE NULL END) AS avgTat,
  -- DELTA: Previous day metrics (2026-05-27)
  SUM(CASE WHEN t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-28'
           AND t.TaskStatusID IN (1, 4, 5, 6) THEN 1 ELSE 0 END) AS prevTasks,
  SUM(CASE WHEN t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-28'
           AND t.TaskStatusID IN (1, 4, 5, 6)
           AND (DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 > t.SLAInHours
                OR (t.SLAAdjustedDate IS NOT NULL AND CAST('2026-05-29' AS DATETIME) > t.SLAAdjustedDate))
           THEN 1 ELSE 0 END) AS prevOverdue,
  AVG(CASE WHEN t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-28'
           THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                     THEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0
                     ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END ELSE NULL END) AS prevTat
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
  AND t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-29'
```

### Query 2 — SLA % (Completed tasks only — DateCompleted)
```sql
SELECT
  -- Overall SLA %: completed tasks within SLA target ÷ total completed × 100
  CAST(
    SUM(CASE WHEN t.DateCompleted >= '2026-05-28' AND t.DateCompleted < '2026-05-29'
             AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= t.SLAInHours
             THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN t.DateCompleted >= '2026-05-28' AND t.DateCompleted < '2026-05-29'
                      THEN 1 ELSE 0 END), 0) * 100 AS overallSla,
  -- DELTA: Previous day SLA % (2026-05-27)
  CAST(
    SUM(CASE WHEN t.DateCompleted >= '2026-05-27' AND t.DateCompleted < '2026-05-28'
             AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= t.SLAInHours
             THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN t.DateCompleted >= '2026-05-27' AND t.DateCompleted < '2026-05-28'
                      THEN 1 ELSE 0 END), 0) * 100 AS prevSla
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID = 2
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
  AND t.DateCompleted >= '2026-05-27' AND t.DateCompleted < '2026-05-29'
```

---

## 2. Teams — `/api/teams`

### Query 1 — Team Volume, Avg TAT, Overdue (active tasks — DateCreated today)
```sql
SELECT
  CASE
    WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
    WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
    WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
    WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
  END AS teamId,
  -- Volume: active tasks only
  SUM(CASE WHEN t.TaskStatusID IN (1, 4, 5, 6) THEN 1 ELSE 0 END) AS volume,
  -- Avg TAT: mixed (open tasks: real-time; closed: DateCompleted-DateCreated)
  AVG(CASE WHEN t.TaskStatusID IN (1,4,5,6)
           THEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0
           ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END) AS avgTat,
  -- Overdue: open tasks exceeding SLA or past SLAAdjustedDate
  SUM(CASE WHEN t.TaskStatusID IN (1, 4, 5, 6)
           AND (DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 > t.SLAInHours
                OR (t.SLAAdjustedDate IS NOT NULL AND CAST('2026-05-29' AS DATETIME) > t.SLAAdjustedDate))
           THEN 1 ELSE 0 END) AS overdue
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
  AND t.DateCreated >= '2026-05-28' AND t.DateCreated < '2026-05-29'
GROUP BY CASE
  WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
  WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
  WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
  WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
END
```

### Query 2 — Team Delta (Volume, TAT, Overdue — today vs prev biz day)
```sql
SELECT
  CASE
    WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
    WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
    WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
    WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
  END AS teamId,
  -- Today volume
  SUM(CASE WHEN t.DateCreated >= '2026-05-28' AND t.DateCreated < '2026-05-29' AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS todayVol,
  -- Prev volume
  SUM(CASE WHEN t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-28' AND t.TaskStatusID IN (1,4,5,6) THEN 1 ELSE 0 END) AS prevVol,
  -- Today overdue
  SUM(CASE WHEN t.DateCreated >= '2026-05-28' AND t.DateCreated < '2026-05-29' AND t.TaskStatusID IN (1,4,5,6)
           AND (DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 > t.SLAInHours
                OR (t.SLAAdjustedDate IS NOT NULL AND CAST('2026-05-29' AS DATETIME) > t.SLAAdjustedDate))
           THEN 1 ELSE 0 END) AS todayOverdue,
  -- Prev overdue
  SUM(CASE WHEN t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-28' AND t.TaskStatusID IN (1,4,5,6)
           AND (DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 > t.SLAInHours
                OR (t.SLAAdjustedDate IS NOT NULL AND CAST('2026-05-29' AS DATETIME) > t.SLAAdjustedDate))
           THEN 1 ELSE 0 END) AS prevOverdue,
  -- Today avg TAT
  AVG(CASE WHEN t.DateCreated >= '2026-05-28' AND t.DateCreated < '2026-05-29'
           THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                     THEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0
                     ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END ELSE NULL END) AS todayTat,
  -- Prev avg TAT
  AVG(CASE WHEN t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-28'
           THEN CASE WHEN t.TaskStatusID IN (1,4,5,6)
                     THEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0
                     ELSE DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 END ELSE NULL END) AS prevTat
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID IN (1, 2, 4, 5, 6)
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
  AND t.DateCreated >= '2026-05-27' AND t.DateCreated < '2026-05-29'
GROUP BY CASE
  WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
  WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
  WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
  WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
END
```

### Query 3 — Team SLA % (Completed tasks — DateCompleted today & prev biz day)
```sql
SELECT
  CASE
    WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
    WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
    WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
    WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
  END AS teamId,
  -- Today SLA %
  CAST(
    SUM(CASE WHEN t.DateCompleted >= '2026-05-28' AND t.DateCompleted < '2026-05-29'
             AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= t.SLAInHours
             THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN t.DateCompleted >= '2026-05-28' AND t.DateCompleted < '2026-05-29'
                      THEN 1 ELSE 0 END), 0) * 100 AS todaySla,
  -- Prev SLA %
  CAST(
    SUM(CASE WHEN t.DateCompleted >= '2026-05-27' AND t.DateCompleted < '2026-05-28'
             AND DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= t.SLAInHours
             THEN 1 ELSE 0 END) AS FLOAT)
    / NULLIF(SUM(CASE WHEN t.DateCompleted >= '2026-05-27' AND t.DateCompleted < '2026-05-28'
                      THEN 1 ELSE 0 END), 0) * 100 AS prevSla
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID = 2
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
  AND t.DateCompleted >= '2026-05-27' AND t.DateCompleted < '2026-05-29'
GROUP BY CASE
  WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
  WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
  WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
  WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
END
```

---

## 3. Alerts — `/api/alerts`

```sql
SELECT
  CASE
    WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
    WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
    WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
    WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
  END AS teamId,
  COUNT(*) AS total,
  SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 <= t.SLAInHours
            AND (t.SLAAdjustedDate IS NULL OR CAST('2026-05-29' AS DATETIME) <= t.SLAAdjustedDate)
            THEN 1 ELSE 0 END) AS compliant,
  SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 > t.SLAInHours
            OR (t.SLAAdjustedDate IS NOT NULL AND CAST('2026-05-29' AS DATETIME) > t.SLAAdjustedDate)
            THEN 1 ELSE 0 END) AS overdue
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID IN (1, 4, 5, 6)
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
GROUP BY CASE
  WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
  WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
  WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
  WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
END

-- Alert severity logic (applied in JavaScript after query):
-- IF pct < 75 THEN 'critical' ELSE IF pct < 90 THEN 'warning' ELSE NULL (no alert)
-- pct = (compliant / total) * 100
```

---

## 4. Loan Summary — `/api/loan-summary`

```sql
-- Query 1: Applications Received
SELECT
  SUM(CASE WHEN Date_ApplicationReceived >= '2026-05-28' AND Date_ApplicationReceived < '2026-05-29' THEN 1 ELSE 0 END) AS todayCount,
  ISNULL(SUM(CASE WHEN Date_ApplicationReceived >= '2026-05-28' AND Date_ApplicationReceived < '2026-05-29' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0) AS todayAmt,
  SUM(CASE WHEN Date_ApplicationReceived >= '2026-05-27' AND Date_ApplicationReceived < '2026-05-28' THEN 1 ELSE 0 END) AS prevCount,
  ISNULL(SUM(CASE WHEN Date_ApplicationReceived >= '2026-05-27' AND Date_ApplicationReceived < '2026-05-28' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0) AS prevAmt
FROM Loans WITH (NOLOCK)
WHERE Date_ApplicationReceived >= '2026-05-27' AND Date_ApplicationReceived < '2026-05-29'

-- Query 2: Funder Approvals
SELECT
  SUM(CASE WHEN Date_FunderApproval >= '2026-05-28' AND Date_FunderApproval < '2026-05-29' THEN 1 ELSE 0 END) AS todayCount,
  ISNULL(SUM(CASE WHEN Date_FunderApproval >= '2026-05-28' AND Date_FunderApproval < '2026-05-29' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0) AS todayAmt,
  SUM(CASE WHEN Date_FunderApproval >= '2026-05-27' AND Date_FunderApproval < '2026-05-28' THEN 1 ELSE 0 END) AS prevCount,
  ISNULL(SUM(CASE WHEN Date_FunderApproval >= '2026-05-27' AND Date_FunderApproval < '2026-05-28' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0) AS prevAmt
FROM Loans WITH (NOLOCK)
WHERE Date_FunderApproval >= '2026-05-27' AND Date_FunderApproval < '2026-05-29'

-- Query 3: Settlements
SELECT
  SUM(CASE WHEN Date_Settled >= '2026-05-28' AND Date_Settled < '2026-05-29' THEN 1 ELSE 0 END) AS todayCount,
  ISNULL(SUM(CASE WHEN Date_Settled >= '2026-05-28' AND Date_Settled < '2026-05-29' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0) AS todayAmt,
  SUM(CASE WHEN Date_Settled >= '2026-05-27' AND Date_Settled < '2026-05-28' THEN 1 ELSE 0 END) AS prevCount,
  ISNULL(SUM(CASE WHEN Date_Settled >= '2026-05-27' AND Date_Settled < '2026-05-28' THEN ISNULL(LoanAmount, 0) ELSE 0 END), 0) AS prevAmt
FROM Loans WITH (NOLOCK)
WHERE Date_Settled >= '2026-05-27' AND Date_Settled < '2026-05-29'
```

---

## 5. History Chart — `/api/history`

```sql
-- Range: 90d (retrieves data for last 128 calendar days to ensure 90 biz days)
-- All calculations use DateCompleted (not DateCreated)

SELECT
  CONVERT(varchar(10), t.DateCompleted, 120) AS Date,
  CASE
    WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
    WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
    WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
    WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
  END AS teamId,
  COUNT(*) AS total,
  SUM(CASE WHEN DATEDIFF(MINUTE, t.DateCreated, t.DateCompleted) / 60.0 <= t.SLAInHours THEN 1 ELSE 0 END) AS compliant
FROM Tasks t WITH (NOLOCK)
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID = 2
  AND t.DateCompleted >= DATEADD(DAY, -128, '2026-05-28')
  AND t.DateCompleted IS NOT NULL
  AND t.DateCreated IS NOT NULL
  AND t.SLAInHours > 0
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
GROUP BY CONVERT(varchar(10), t.DateCompleted, 120),
         CASE
           WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
           WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
           WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
           WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
         END
ORDER BY Date, teamId
```

---

## 6. Tasks List — `/api/tasks`

```sql
-- Query params: ?team=<1-8>&status=ok|warn|bad&atRiskPct=87.5
-- Status logic (atRiskPct default 87.5%):
-- - 'ok'  : TAT < 87.5% of SLA target
-- - 'warn': 87.5% ≤ TAT ≤ SLA target (and SLAAdjustedDate not passed)
-- - 'bad' : TAT > SLA target OR SLAAdjustedDate passed

SELECT TOP 500
  t.TaskID,
  t.TaskName,
  t.ShortDescription,
  t.TotalHoursOnTask,
  t.TotalHoursOnTask_BH,
  t.SLAInHours,
  t.SoEzySLA,
  NULL AS SLARemaining,
  t.DateCreated,
  t.Priority,
  t.TaskStatusID,
  ts.TaskStatus,
  CASE
    WHEN s.DepartmentId = 101 THEN 1 WHEN s.DepartmentId = 110 THEN 2 WHEN s.DepartmentId = 86  THEN 3
    WHEN s.DepartmentId = 122 THEN 4 WHEN cls.Name LIKE N'%CLA%' THEN 5
    WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 6
    WHEN s.DepartmentId = 12  THEN 7 WHEN s.DepartmentId = 10  THEN 8
  END AS QueueId,
  CASE
    WHEN s.DepartmentId = 101 THEN 'Data Entry' WHEN s.DepartmentId = 110 THEN 'Valuations'
    WHEN s.DepartmentId = 86  THEN 'Assessments' WHEN s.DepartmentId = 122 THEN 'Packaging & QA'
    WHEN cls.Name LIKE N'%CLA%' THEN 'CLA'
    WHEN (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%') THEN 'Funder Submission'
    WHEN s.DepartmentId = 12  THEN 'Settlement' WHEN s.DepartmentId = 10  THEN 'Ezy Client Care'
  END AS QueueName,
  t.AssignedTo,
  s.FirstName AS AssignedToName,
  RTRIM(ISNULL(s.FirstName,'') + ISNULL(' ' + s.Surname, '')) AS StaffFullName,
  CASE
    WHEN t.SLAInHours IS NULL OR t.SLAInHours = 0 THEN 'ok'
    WHEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 > t.SLAInHours
      OR (t.SLAAdjustedDate IS NOT NULL AND CAST('2026-05-29' AS DATETIME) > t.SLAAdjustedDate) THEN 'bad'
    WHEN DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 >= t.SLAInHours * 0.875 THEN 'warn'
    ELSE 'ok'
  END AS status
FROM Tasks t WITH (NOLOCK)
LEFT JOIN ConfigTaskStatus ts WITH (NOLOCK) ON t.TaskStatusID = ts.ConfigTaskStatusID
LEFT JOIN Staff s WITH (NOLOCK) ON t.AssignedTo = s.StaffID
LEFT JOIN REPORT_Loans_Extension rle WITH (NOLOCK) ON t.ApplicationID = rle.ApplicationID
LEFT JOIN ConfigLoanStatus cls WITH (NOLOCK) ON rle.ConfigLoanStatusId = cls.ConfigLoanStatusId
WHERE t.TaskStatusID IN (1, 4, 5, 6)
  AND (
    (s.DepartmentId IN (101,110,86,122,12,10) AND s.EmployeeStatus = 1)
    OR cls.Name LIKE N'%CLA%'
    OR (cls.Name LIKE N'%funder approval to be obtained%' OR cls.Name LIKE N'%house%')
  )
  -- Optional team filter (if ?team=N provided)
  -- AND s.DepartmentId = 101 (example for team 1: Data Entry)
  -- Optional status filters (if ?status provided)
  -- AND status = 'bad' (example)
ORDER BY DATEDIFF(MINUTE, t.DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0 DESC
```

---

## Notes for Audit

- **All dates use local calendar days (not UTC)** to avoid AEST timezone off-by-one issues
- **TAT calculations differ by task state:**
  - **Active tasks (status 1,4,5,6):** `DATEDIFF(MINUTE, DateCreated, CAST('2026-05-29' AS DATETIME)) / 60.0`
  - **Completed tasks (status 2):** `DATEDIFF(MINUTE, DateCreated, DateCompleted) / 60.0`
- **SLA % uses DateCompleted scoping** (not DateCreated) for all calculations
- **Overdue logic:** TAT > SLA target **OR** (SLAAdjustedDate IS NOT NULL AND current datetime > SLAAdjustedDate)
- **At-Risk threshold:** Configurable via Settings; default 87.5% of team SLA target
- **Teams 5 & 6 (CLA, Funder Submission)** identified by `ConfigLoanStatus.Name` pattern, not `Staff.DepartmentId`
- **All queries use `WITH (NOLOCK)`** for read-only consistency
- **Dates fixed to 2026-05-28** for snapshot testing; use `GETDATE()` in live mode
