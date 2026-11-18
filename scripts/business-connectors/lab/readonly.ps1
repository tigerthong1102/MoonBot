function Test-ScopedRead([Data.SqlClient.SqlConnection]$Owner) {
    if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or
        $Owner.DataSource -notmatch '^\(localdb\)\\StartupBotLab[0-9a-f]{32}$') { throw 'Disposable LocalDB fixture required.' }

    function Invoke-FixtureStatement($connection, [string]$sql, $transaction = $null) {
        $command = $connection.CreateCommand()
        try {
            $command.Transaction = $transaction
            $command.CommandTimeout = 5
            $command.CommandText = $sql
            [void]$command.ExecuteNonQuery()
        } finally { $command.Dispose() }
    }

    function Assert-Denied($connection, [string]$sql, [int[]]$numbers) {
        $caught = $false
        try { Invoke-FixtureStatement $connection $sql }
        catch [Data.SqlClient.SqlException] {
            if ($numbers -notcontains $_.Exception.Number) { throw }
            $caught = $true
        }
        if (-not $caught) { throw 'Expected SQL Server to refuse the operation.' }
    }

    Invoke-FixtureStatement $Owner 'CREATE DATABASE FixtureCompanyA'
    Invoke-FixtureStatement $Owner 'CREATE DATABASE FixtureCompanyB'
    foreach ($database in @('FixtureCompanyA', 'FixtureCompanyB')) {
        $Owner.ChangeDatabase($database)
        Invoke-FixtureStatement $Owner @'
CREATE TABLE dbo.Entries (id int PRIMARY KEY, voucher nvarchar(16) NOT NULL, amount decimal(24,4) NOT NULL);
INSERT dbo.Entries VALUES (1,N'00017',12345678901234567890.1200),(2,N'00018',-0.0001);
'@
        Invoke-FixtureStatement $Owner 'CREATE VIEW dbo.AllowedEntries AS SELECT id,voucher,amount FROM dbo.Entries'
    }
    $Owner.ChangeDatabase('FixtureCompanyA')
    Invoke-FixtureStatement $Owner 'CREATE USER FixtureReader WITHOUT LOGIN; GRANT SELECT ON dbo.AllowedEntries TO FixtureReader'
    $restricted = [Data.SqlClient.SqlConnection]::new($Owner.ConnectionString)
    try {
        $restricted.Open()
        $restricted.ChangeDatabase('FixtureCompanyA')
        Invoke-FixtureStatement $restricted "EXECUTE AS USER = 'FixtureReader' WITH NO REVERT"
        $read = $restricted.CreateCommand()
        try {
            $read.CommandTimeout = 5
            $read.CommandText = "SELECT TOP (1) id,voucher,CONVERT(varchar(42),amount),DB_NAME(),USER_NAME() FROM dbo.AllowedEntries WHERE id > @after ORDER BY id"
            $after = $read.Parameters.Add('@after', [Data.SqlDbType]::Int)
            $after.Value = 0
            $first = $read.ExecuteReader()
            try {
                if (-not $first.Read() -or $first.GetString(1) -cne '00017' -or $first.GetString(2) -cne '12345678901234567890.1200' -or
                    $first.GetString(3) -ne 'FixtureCompanyA' -or $first.GetString(4) -ne 'FixtureReader') { throw 'Unexpected scoped row.' }
                $afterId = $first.GetInt32(0)
            } finally { $first.Dispose() }

            Assert-Denied $restricted 'SELECT voucher FROM dbo.Entries' @(229)
            Assert-Denied $restricted 'SELECT voucher FROM FixtureCompanyB.dbo.AllowedEntries' @(916,229)
            Assert-Denied $restricted 'UPDATE dbo.Entries SET amount=amount WHERE id=-1' @(229)
            $transaction = $Owner.BeginTransaction()
            try {
                Invoke-FixtureStatement $Owner 'UPDATE dbo.Entries SET amount=0 WHERE id=2' $transaction
                $read.CommandTimeout = 1
                $after.Value = $afterId
                $timeout = $false
                try { [void]$read.ExecuteScalar() } catch [Data.SqlClient.SqlException] {
                    if ($_.Exception.Number -ne -2) { throw }
                    $timeout = $true
                }
                if (-not $timeout) { throw 'Expected bounded timeout on the locked second row.' }
            } finally { $transaction.Rollback(); $transaction.Dispose() }

            $read.CommandTimeout = 5
            if ($read.ExecuteScalar() -ne 2) { throw 'Expected next row after fixture lock release.' }
            Invoke-FixtureStatement $Owner 'REVOKE SELECT ON dbo.AllowedEntries FROM FixtureReader'
            Assert-Denied $restricted 'SELECT id FROM dbo.AllowedEntries WHERE id>1' @(229)
            Write-Host 'Scoped view read passed. Base table, cross-company read, write and revoked read denied. Blocked read timed out.'
        } finally { $read.Dispose() }
    } finally { $restricted.Dispose() }
}
