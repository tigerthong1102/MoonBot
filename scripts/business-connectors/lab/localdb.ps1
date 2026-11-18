#requires -version 5.1
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
    throw 'This fixture requires a disposable GitHub-hosted Windows runner.'
}
$utility = Get-Command SqlLocalDB.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $utility) {
    $utility = Get-ChildItem -Path "$env:ProgramFiles\Microsoft SQL Server\*\Tools\Binn\SqlLocalDB.exe" -File |
        Sort-Object { $_.VersionInfo.FileMajorPart } -Descending | Select-Object -First 1
    if (-not $utility) { throw 'LocalDB runtime unavailable on this image.' }
}
$exe = $utility.Path
if (-not $exe) { $exe = $utility.FullName }
$name = 'StartupBotLab' + [guid]::NewGuid().ToString('N')
$created = $false
$connection = $null
try {
    & $exe create $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture creation failed.' }
    $created = $true
    & $exe start $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture startup failed.' }
    $connection = [Data.SqlClient.SqlConnection]::new("Server=(localdb)\$name;Initial Catalog=master;Integrated Security=true;Pooling=false;Connect Timeout=10")
    $connection.Open()
    $command = $connection.CreateCommand()
    $command.CommandTimeout = 5
    $command.CommandText = @'
SELECT CONVERT(varchar(32), SERVERPROPERTY('ProductVersion')),
       CONVERT(int, SERVERPROPERTY('IsLocalDB')),
       CONVERT(varchar(40), CONNECTIONPROPERTY('net_transport')),
       CONVERT(varchar(40), CONNECTIONPROPERTY('auth_scheme')),
       CONVERT(varchar(42), CAST(-12345678901234567890.1200 AS decimal(24,4))),
       CAST(N'Đắk Lắk' AS nvarchar(32)), CAST('0000123456' AS varchar(10)),
       CONVERT(nvarchar(128), SERVERPROPERTY('Edition'))
'@
    $reader = $command.ExecuteReader()
    if (-not $reader.Read() -or $reader.GetInt32(1) -ne 1) { throw 'Unexpected instance identity.' }
    $version = $reader.GetString(0)
    $transport = $reader.GetString(2)
    if ($version -notmatch '^\d+\.\d+\.\d+\.\d+$' -or $transport -notin 'Shared memory','Named pipe') { throw 'Unexpected engine metadata.' }
    $auth = $reader.GetString(3)
    if ($auth -notin 'NTLM','KERBEROS') { throw 'Expected Windows Integrated Authentication.' }
    $sample = @{ productVersion = $version; edition = $reader.GetString(7); amount = $reader.GetString(4);
        description = $reader.GetString(5); code = $reader.GetString(6) }
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $sample | ConvertTo-Json -Compress | node "$PSScriptRoot/verify-sample.ts"
    if ($LASTEXITCODE -ne 0) { throw 'Accounting sample did not round-trip into Node.' }
    $reader.Dispose()
    $command.Dispose()
    . "$PSScriptRoot/readonly.ps1"
    Test-ScopedRead $connection
    Write-Host "Verified LocalDB $version, $transport, $auth; System.Data $([Data.SqlClient.SqlConnection].Assembly.GetName().Version), $([IntPtr]::Size * 8)-bit."
} finally {
    if ($connection) { $connection.Dispose() }
    if ($created) {
        & $exe stop $name -k | Out-Null
        & $exe delete $name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Fixture cleanup failed.' }
    }
}
