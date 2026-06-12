-- Run this in SQL Server Management Studio on MySEReport database
-- Creates the DashboardUsers table and seeds the admin account

USE MySEReport;
GO

-- Create table if it doesn't exist
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DashboardUsers')
BEGIN
  CREATE TABLE DashboardUsers (
    UserID       INT IDENTITY(1,1) PRIMARY KEY,
    Email        NVARCHAR(255) NOT NULL UNIQUE,
    CompanyName  NVARCHAR(255) NOT NULL,
    PasswordHash NVARCHAR(255) NOT NULL,
    Role         NVARCHAR(50)  NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
    IsApproved   BIT           NOT NULL DEFAULT 0,
    IsRejected   BIT           NOT NULL DEFAULT 0,
    CreatedAt    DATETIME2     NOT NULL DEFAULT GETDATE()
  );
  PRINT 'DashboardUsers table created.';
END
ELSE
  PRINT 'DashboardUsers table already exists.';
GO

-- Add IsRejected column if upgrading from an earlier schema (safe no-op if present)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'DashboardUsers' AND COLUMN_NAME = 'IsRejected'
)
  ALTER TABLE DashboardUsers ADD IsRejected BIT NOT NULL DEFAULT 0;
GO

-- Migrate admin email from ntruong@mezy.com → ntruong@mezy.com.au (if old row exists)
UPDATE DashboardUsers
   SET Email = 'ntruong@mezy.com.au'
 WHERE Email = 'ntruong@mezy.com';
GO

-- Seed admin account (ntruong@mezy.com.au / 123456)
-- Hash below is bcrypt of '123456' with 12 rounds
IF NOT EXISTS (SELECT 1 FROM DashboardUsers WHERE Email = 'ntruong@mezy.com.au')
BEGIN
  INSERT INTO DashboardUsers (Email, CompanyName, PasswordHash, Role, IsApproved)
  VALUES (
    'ntruong@mezy.com.au',
    'Mortgage Ezy',
    '$2b$12$20T1DiXYrbeLtcR8mwxKyeoTYxlBordvCow0jhSpTDYd6i9yY.X6S',
    'admin',
    1  -- pre-approved
  );
  PRINT 'Admin account created.';
END
ELSE
  PRINT 'Admin account already exists.';
GO

-- To approve a pending signup, run:
-- UPDATE DashboardUsers SET IsApproved = 1, IsRejected = 0 WHERE Email = 'user@company.com';

-- To reject a user, run:
-- UPDATE DashboardUsers SET IsApproved = 0, IsRejected = 1 WHERE Email = 'user@company.com';

-- To see all users:
-- SELECT UserID, Email, CompanyName, Role, IsApproved, IsRejected, CreatedAt FROM DashboardUsers;
