-- ============================================================
-- SLA Dashboard — New Auth/Access Schema Migration
-- Run this in SSMS on the target database (MySEReport).
-- NOTE: Replace "MySEReport" below with your actual DB name
--       if it differs.
--
-- Steps performed by this script:
--   1. Create ConfigReportUsers, ConfigDashboards, DashboardAccess
--   2. Create indexes on DashboardAccess FK columns
--   3. Seed ConfigDashboards with the SLA Dashboard (ID = 1)
--   4. Migrate existing DashboardUsers rows to the new tables
--      (only rows whose Email matches a Staff.EmailAddress)
--   5. Drop DashboardUsers
-- ============================================================

USE MySEReport;
GO

-- =============================================
-- 1. Table: ConfigReportUsers
-- =============================================
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ConfigReportUsers')
BEGIN
    CREATE TABLE [dbo].[ConfigReportUsers] (
        [UserId]           INT            NOT NULL IDENTITY(1,1),
        [StaffId]          INT            NOT NULL,  -- FK to Staff.StaffID
        [PasswordHash]     NVARCHAR(MAX)  NULL,
        [CreatedAt]        DATETIME       NOT NULL,
        [ResetToken]       NVARCHAR(MAX)  NULL,
        [ResetTokenExpiry] NVARCHAR(MAX)  NULL,

        CONSTRAINT [PK_ConfigReportUsers] PRIMARY KEY CLUSTERED ([UserId] ASC),
        CONSTRAINT [FK_ConfigReportUsers_Staff]
            FOREIGN KEY ([StaffId])
            REFERENCES [dbo].[Staff] ([StaffID])
            ON UPDATE NO ACTION
            ON DELETE NO ACTION
    );
    PRINT 'ConfigReportUsers created.';
END
ELSE
    PRINT 'ConfigReportUsers already exists — skipped.';
GO

-- =============================================
-- 2. Table: ConfigDashboards
-- =============================================
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ConfigDashboards')
BEGIN
    CREATE TABLE [dbo].[ConfigDashboards] (
        [DashboardID] INT            NOT NULL IDENTITY(1,1),
        [Name]        NVARCHAR(100)  NOT NULL,
        [IsActive]    BIT            NOT NULL CONSTRAINT [DF_ConfigDashboards_IsActive] DEFAULT (1),

        CONSTRAINT [PK_ConfigDashboards] PRIMARY KEY CLUSTERED ([DashboardID] ASC)
    );
    PRINT 'ConfigDashboards created.';
END
ELSE
    PRINT 'ConfigDashboards already exists — skipped.';
GO

-- =============================================
-- 3. Table: DashboardAccess
-- =============================================
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DashboardAccess')
BEGIN
    CREATE TABLE [dbo].[DashboardAccess] (
        [ConfigDashboardId] INT          NOT NULL,
        [UserId]            INT          NOT NULL,
        [Role]              NVARCHAR(50) NULL,
        [IsActive]          BIT          NOT NULL CONSTRAINT [DF_DashboardAccess_IsActive] DEFAULT (1),

        CONSTRAINT [PK_DashboardAccess] PRIMARY KEY CLUSTERED (
            [ConfigDashboardId] ASC,
            [UserId] ASC
        ),
        CONSTRAINT [FK_DashboardAccess_ConfigDashboards]
            FOREIGN KEY ([ConfigDashboardId])
            REFERENCES [dbo].[ConfigDashboards] ([DashboardID])
            ON UPDATE NO ACTION
            ON DELETE NO ACTION,
        CONSTRAINT [FK_DashboardAccess_ConfigReportUsers]
            FOREIGN KEY ([UserId])
            REFERENCES [dbo].[ConfigReportUsers] ([UserId])
            ON UPDATE NO ACTION
            ON DELETE NO ACTION
    );
    PRINT 'DashboardAccess created.';
END
ELSE
    PRINT 'DashboardAccess already exists — skipped.';
GO

-- =============================================
-- 4. Indexes on DashboardAccess FK columns
-- =============================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DashboardAccess_UserId' AND object_id = OBJECT_ID('DashboardAccess'))
    CREATE NONCLUSTERED INDEX [IX_DashboardAccess_UserId]
        ON [dbo].[DashboardAccess] ([UserId] ASC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DashboardAccess_ConfigDashboardId' AND object_id = OBJECT_ID('DashboardAccess'))
    CREATE NONCLUSTERED INDEX [IX_DashboardAccess_ConfigDashboardId]
        ON [dbo].[DashboardAccess] ([ConfigDashboardId] ASC);
GO

-- =============================================
-- 5. Seed ConfigDashboards — SLA Dashboard (ID = 1)
--    SLA_DASHBOARD_ID constant in server.js must match this row.
-- =============================================
IF NOT EXISTS (SELECT 1 FROM ConfigDashboards WHERE Name = 'SLA Dashboard')
BEGIN
    -- Reset identity to 1 so server.js SLA_DASHBOARD_ID = 1 is always correct
    DBCC CHECKIDENT ('ConfigDashboards', RESEED, 0);
    INSERT INTO ConfigDashboards (Name, IsActive) VALUES ('SLA Dashboard', 1);
    PRINT 'ConfigDashboards seeded: SLA Dashboard (ID=1).';
END
ELSE
    PRINT 'ConfigDashboards already has SLA Dashboard — skipped.';
GO

-- =============================================
-- 6. Migrate DashboardUsers → new tables
--    Only migrates rows where DashboardUsers.Email matches Staff.EmailAddress.
--    Rows with no matching Staff are skipped (log shown below).
-- =============================================
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DashboardUsers')
BEGIN
    -- 6a. Show any emails that will NOT be migrated (no Staff match)
    SELECT du.Email, du.Role, du.IsApproved, du.IsRejected
    FROM DashboardUsers du
    WHERE NOT EXISTS (
        SELECT 1 FROM Staff s WHERE LOWER(s.EmailAddress) = LOWER(du.Email)
    );
    -- (0 rows = all users migrated. Non-zero = those users must be re-registered.)

    -- 6b. Insert into ConfigReportUsers for matched staff
    INSERT INTO ConfigReportUsers (StaffId, PasswordHash, CreatedAt, ResetToken, ResetTokenExpiry)
    SELECT
        s.StaffID,
        du.PasswordHash,
        du.CreatedAt,
        du.ResetToken,
        CASE WHEN du.ResetTokenExpiry IS NOT NULL
             THEN CONVERT(NVARCHAR(MAX), du.ResetTokenExpiry, 126)
             ELSE NULL END
    FROM DashboardUsers du
    INNER JOIN Staff s ON LOWER(s.EmailAddress) = LOWER(du.Email)
    WHERE NOT EXISTS (
        SELECT 1 FROM ConfigReportUsers cru WHERE cru.StaffId = s.StaffID
    );
    PRINT CONCAT('Migrated ', @@ROWCOUNT, ' user(s) into ConfigReportUsers.');

    -- 6c. Insert DashboardAccess for approved or rejected users
    --     Approved  → IsActive = 1
    --     Rejected  → IsActive = 0
    --     Pending   → no row (matches new "pending = no record" semantic)
    INSERT INTO DashboardAccess (ConfigDashboardId, UserId, Role, IsActive)
    SELECT
        1,           -- SLA Dashboard
        cru.UserId,
        du.Role,
        CASE WHEN du.IsRejected = 1 THEN 0 ELSE 1 END
    FROM DashboardUsers du
    INNER JOIN Staff s ON LOWER(s.EmailAddress) = LOWER(du.Email)
    INNER JOIN ConfigReportUsers cru ON cru.StaffId = s.StaffID
    WHERE (du.IsApproved = 1 OR du.IsRejected = 1)
      AND NOT EXISTS (
        SELECT 1 FROM DashboardAccess da
        WHERE da.UserId = cru.UserId AND da.ConfigDashboardId = 1
    );
    PRINT CONCAT('Migrated ', @@ROWCOUNT, ' access row(s) into DashboardAccess.');

    PRINT 'Migration complete. Verify the SELECT output above before dropping DashboardUsers.';
END
ELSE
    PRINT 'DashboardUsers table not found — migration step skipped.';
GO

-- =============================================
-- 7. Drop DashboardUsers
--    Only run AFTER verifying migration above is correct.
--    Uncomment when ready.
-- =============================================
-- IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DashboardUsers')
-- BEGIN
--     DROP TABLE [dbo].[DashboardUsers];
--     PRINT 'DashboardUsers dropped.';
-- END
-- GO

PRINT 'Done. Uncomment Step 7 above and re-run when migration looks correct.';
GO
