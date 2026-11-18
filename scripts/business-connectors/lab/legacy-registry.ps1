#requires -version 5.1
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'Disposable Windows runner required.' }
. "$PSScriptRoot/../instance-registry.ps1"
$parent = [Microsoft.Win32.Registry]::CurrentUser
$path = "Software\StartupBotInventoryFixture-" + [guid]::NewGuid().ToString('N')
$base = $parent.CreateSubKey($path)
function Set-FixtureValue($path, $name, $value, $kind) {
    $key = $base.CreateSubKey($path)
    try { $key.SetValue($name, $value, $kind) } finally { $key.Dispose() }
}
try {
    $sql = 'SOFTWARE\Microsoft\Microsoft SQL Server'
    Set-FixtureValue $sql 'InstalledInstances' ([string[]]@('MSSQLSERVER','KE_TOAN')) 'MultiString'
    Set-FixtureValue 'SOFTWARE\Microsoft\MSSQLServer\MSSQLServer\CurrentVersion' 'CurrentVersion' '8.00.2039' 'String'
    Set-FixtureValue "$sql\Instance Names\SQL" 'KE_TOAN' 'MSSQL.1' 'String'
    Set-FixtureValue "$sql\MSSQL.1\Setup" 'Version' '9.00.5000.00' 'String'
    $rows = [Collections.Generic.List[object]]::new()
    $issues = [Collections.Generic.HashSet[string]]::new()
    Read-Instances $base 'Registry32' $rows $issues
    $default = @($rows | Where-Object { $_.name -eq 'MSSQLSERVER' -and $_.version -eq '8.00.2039' })
    $named = @($rows | Where-Object { $_.name -eq 'KE_TOAN' -and $_.version -eq '9.00.5000.00' })
    if ($issues.Count -ne 0 -or $default.Count -ne 1 -or $named.Count -ne 1) { throw 'Legacy registry fixture mismatch.' }
} finally {
    $base.Dispose()
    $parent.DeleteSubKeyTree($path)
}
