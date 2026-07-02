-- SLA Dashboard performance indexes.
-- Safe to re-run: each CREATE is wrapped in an IF NOT EXISTS check.
-- Cost: ~a few hundred MB total; one-off build time on the initial CREATE.
-- Benefit: cold reads on Tasks drop from ~30-115s to sub-second by eliminating
-- full 1M-row scans on the endpoints that hit /api/kpi-summary, /api/teams,
-- /api/tasks, /api/alerts, /api/history and /api/loan-summary.

SET NOCOUNT ON;

-- 1) Fast "today/prev day" scans on Tasks by DateCreated + status.
--    Covers KPI summary, teams, alerts, active-task drill-downs.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_DateCreated_Status' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    PRINT 'Creating IX_Tasks_DateCreated_Status ...';
    CREATE NONCLUSTERED INDEX IX_Tasks_DateCreated_Status
      ON dbo.Tasks (DateCreated, TaskStatusID)
      INCLUDE (ConfigTaskId, AssignedTo, SLAAdjustedDate, DateCompleted,
               ApplicationID, TaskName, SLAInHours, FunctionID);
END
ELSE
    PRINT 'IX_Tasks_DateCreated_Status already exists.';

-- 2) SLA% calculations scope by DateCompleted, not DateCreated.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tasks_DateCompleted_Status' AND object_id = OBJECT_ID('dbo.Tasks'))
BEGIN
    PRINT 'Creating IX_Tasks_DateCompleted_Status ...';
    CREATE NONCLUSTERED INDEX IX_Tasks_DateCompleted_Status
      ON dbo.Tasks (DateCompleted, TaskStatusID)
      INCLUDE (DateCreated, SLAAdjustedDate, ConfigTaskId, AssignedTo,
               SLAInHours, FunctionID);
END
ELSE
    PRINT 'IX_Tasks_DateCompleted_Status already exists.';

-- 3) The team-filter join needs to reach Staff.DepartmentId / EmployeeStatus
--    from Tasks.AssignedTo cheaply. Usually already covered by the PK,
--    but adding a covering index keeps the join in the leaf.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Staff_StaffID_Cover' AND object_id = OBJECT_ID('dbo.Staff'))
BEGIN
    PRINT 'Creating IX_Staff_StaffID_Cover ...';
    CREATE NONCLUSTERED INDEX IX_Staff_StaffID_Cover
      ON dbo.Staff (StaffID)
      INCLUDE (DepartmentId, EmployeeStatus, FirstName, Surname);
END
ELSE
    PRINT 'IX_Staff_StaffID_Cover already exists.';

-- 4) ConfigTasks lookup by ConfigTaskId (team filter).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ConfigTasks_ConfigTaskId_Cover' AND object_id = OBJECT_ID('dbo.ConfigTasks'))
BEGIN
    PRINT 'Creating IX_ConfigTasks_ConfigTaskId_Cover ...';
    CREATE NONCLUSTERED INDEX IX_ConfigTasks_ConfigTaskId_Cover
      ON dbo.ConfigTasks (ConfigTaskId)
      INCLUDE (UsedForKPI, SpecifiedKPIGrp, TaskCode, TaskName);
END
ELSE
    PRINT 'IX_ConfigTasks_ConfigTaskId_Cover already exists.';

-- 5) Loans milestone-date scans (loan-summary + loan-detail).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Loans_DateApplicationReceived' AND object_id = OBJECT_ID('dbo.Loans'))
BEGIN
    PRINT 'Creating IX_Loans_DateApplicationReceived ...';
    CREATE NONCLUSTERED INDEX IX_Loans_DateApplicationReceived
      ON dbo.Loans (Date_ApplicationReceived)
      INCLUDE (LoanAmount, ApplicationID, FunderName);
END
ELSE
    PRINT 'IX_Loans_DateApplicationReceived already exists.';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Loans_DateFunderApproval' AND object_id = OBJECT_ID('dbo.Loans'))
BEGIN
    PRINT 'Creating IX_Loans_DateFunderApproval ...';
    CREATE NONCLUSTERED INDEX IX_Loans_DateFunderApproval
      ON dbo.Loans (Date_FunderApproval)
      INCLUDE (LoanAmount, ApplicationID, FunderName);
END
ELSE
    PRINT 'IX_Loans_DateFunderApproval already exists.';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Loans_DateSettled' AND object_id = OBJECT_ID('dbo.Loans'))
BEGIN
    PRINT 'Creating IX_Loans_DateSettled ...';
    CREATE NONCLUSTERED INDEX IX_Loans_DateSettled
      ON dbo.Loans (Date_Settled)
      INCLUDE (LoanAmount, ApplicationID, FunderName);
END
ELSE
    PRINT 'IX_Loans_DateSettled already exists.';

PRINT 'Done.';
