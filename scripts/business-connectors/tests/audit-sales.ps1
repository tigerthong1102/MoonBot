function Test-AuditSales($owner) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
        $owner.DataSource -notmatch '^\(localdb\)\\StartupBotLab[0-9a-f]{32}$') { throw 'Disposable LocalDB required.' }
    $owner.ChangeDatabase('master')
    $cmd=$owner.CreateCommand()
    try {
        $cmd.CommandText='CREATE DATABASE FixtureAuditSales'
        [void]$cmd.ExecuteNonQuery()
        $owner.ChangeDatabase('FixtureAuditSales')
        $cmd.CommandText=@'
CREATE TABLE dbo.SAVoucher (RefID int PRIMARY KEY,RefNoFinance nvarchar(16),PostedDate datetime,BranchID uniqueidentifier,IsPostedFinance bit,TotalSaleAmount decimal(18,4));
CREATE TABLE dbo.SAVoucherDetail(RefDetailID int PRIMARY KEY,RefID int,Amount decimal(18,4));
DECLARE @a uniqueidentifier='11111111-1111-4111-8111-111111111111',@b uniqueidentifier=NEWID();
INSERT dbo.SAVoucher VALUES (1,N'00017','20260812',@a,1,-4.1200),(2,N'empty','20260831',@a,1,0),(3,N'other','20260812',@b,1,20),(4,N'next','20260901',@a,1,500),(5,N'draft','20260812',@a,0,100);
INSERT dbo.SAVoucherDetail VALUES (1,1,-5.1200),(2,1,1),(3,3,20),(4,4,500),(5,5,100);
CREATE USER AuditFixtureReader WITHOUT LOGIN;
GRANT SELECT ON dbo.SAVoucher TO AuditFixtureReader;
GRANT SELECT ON dbo.SAVoucherDetail TO AuditFixtureReader;
'@
        [void]$cmd.ExecuteNonQuery()
        $cmd.CommandText="EXECUTE AS USER='AuditFixtureReader' WITH NO REVERT"
        [void]$cmd.ExecuteNonQuery()
        $cmd.CommandText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../../skills/kiem-toan/scripts/monthly-sales.sql'))
        [void]$cmd.Parameters.Add('@branch',[Data.SqlDbType]::UniqueIdentifier)
        $cmd.Parameters['@branch'].Value=[guid]'11111111-1111-4111-8111-111111111111'
        foreach ($name in @('@start','@end')) { [void]$cmd.Parameters.Add($name,[Data.SqlDbType]::DateTime) }
        $cmd.Parameters['@start'].Value=[datetime]'2026-08-01'; $cmd.Parameters['@end'].Value=[datetime]'2026-09-01'
        $r=$cmd.ExecuteReader()
        try {
            if (!$r.Read() -or $r.GetString(1) -cne '00017' -or $r.GetString(3) -cne '-4.1200' -or
                $r.GetString(4) -cne '-4.1200' -or $r.GetInt64(5) -ne 2) { throw 'Signed decimal or voucher identity mismatch.' }
            if (!$r.Read() -or !$r.IsDBNull(4) -or $r.GetInt64(5) -ne 0 -or $r.Read()) { throw 'Scope or missing detail mismatch.' }
        } finally { $r.Dispose() }
    } finally { $cmd.Dispose() }
}
