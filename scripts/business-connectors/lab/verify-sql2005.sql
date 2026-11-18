SET NOCOUNT ON;

DECLARE @version varchar(64);
SET @version = CONVERT(varchar(64), SERVERPROPERTY('ProductVersion'));
IF @version IS NULL OR (@version NOT LIKE '9.%' AND @version NOT LIKE '09.%')
BEGIN
    RAISERROR ('Expected SQL Server 2005 Database Engine (9.x).', 16, 1);
    RETURN;
END;

SELECT @version AS product_version,
       SERVERPROPERTY('ProductLevel') AS product_level,
       SERVERPROPERTY('Edition') AS edition,
       NCHAR(272) + NCHAR(7855) + N'k L' + NCHAR(7855) + N'k' AS unicode_sample,
       '00017' AS document_number,
       CONVERT(decimal(24,4), '-12345678901234567890.1200') AS amount_sample;
