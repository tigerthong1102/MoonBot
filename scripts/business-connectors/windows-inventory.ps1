#requires -version 5.1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$observations = [Collections.Generic.List[object]]::new()
$issues = [Collections.Generic.HashSet[string]]::new()
$sqlRoot = 'SOFTWARE\Microsoft\Microsoft SQL Server'
$instancePattern = '^[A-Za-z0-9_#$-]{1,16}$'

function Read-Value($base, $path, $name) {
    $key = $base.OpenSubKey($path)
    if ($null -eq $key) { return }
    try { $key.GetValue($name, $null, 'DoNotExpandEnvironmentNames') }
    finally { $key.Dispose() }
}

function Read-Instances($base, $view) {
    $path = "$sqlRoot\Instance Names\SQL"
    $map = $base.OpenSubKey($path)
    if ($null -ne $map) {
        try {
            foreach ($name in $map.GetValueNames()) {
                $id = $map.GetValue($name)
                if ($name -notmatch $instancePattern -or $id -notmatch '^[A-Za-z0-9_.#$-]{1,128}$') {
                    [void]$issues.Add('instance-registry')
                    continue
                }
                $version = Read-Value $base "$sqlRoot\$id\Setup" 'Version'
                $observations.Add(@{ kind = 'registry'; name = $name; view = $view; version = [string]$version })
            }
        } finally { $map.Dispose() }
    }
    foreach ($name in (Read-Value $base $sqlRoot 'InstalledInstances')) {
        if ($name -notmatch $instancePattern) {
            [void]$issues.Add('instance-registry')
            continue
        }
        $path = "$sqlRoot\$name\MSSQLServer\CurrentVersion"
        if ($name -eq 'MSSQLSERVER') { $path = 'SOFTWARE\Microsoft\MSSQLServer\MSSQLServer\CurrentVersion' }
        $version = Read-Value $base $path 'CurrentVersion'
        $observations.Add(@{ kind = 'registry'; name = $name; view = $view; version = [string]$version })
    }
}

function Read-Applications($base) {
    $uninstall = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
    if ($null -eq $uninstall) { return }
    try {
        $keys = $uninstall.GetSubKeyNames()
        if ($keys.Count -gt 2048) { [void]$issues.Add('applications'); $keys = $keys[0..2047] }
        foreach ($key in $keys) {
            $display = Read-Value $uninstall $key 'DisplayName'
            $product = switch -Regex ($display) {
                '^Smart\s*Pro(?:\s|\d|$)' { 'smartpro'; break }
                '^MISA\s+SME(?:\.NET)?(?:\s|\d|$)' { 'misa-sme'; break }
                '^MISA\s+Mimosa(?:\.NET)?(?:\s|\d|$)' { 'misa-mimosa'; break }
                '^eBH(?:\s+|[-_])(Professional|Pro)(?:\s|\d|$)' { 'ebh-pro'; break }
                '^eBH(?:\s+|[-_])Basic(?:\s|\d|$)' { 'ebh-basic'; break }
                '^eBH(?:\s|\d|$)' { 'ebh-edition-unknown'; break }
                '^Fast Accounting(?:\s|\d|$)' { 'fast-accounting'; break }
                '^Sapo(?:\s|\d|$)' { 'sapo'; break }
            }
            if ($product) {
                $version = Read-Value $uninstall $key 'DisplayVersion'
                if ($version -notmatch '^\d{1,5}(?:\.\d{1,5}){0,3}$') { $version = '' }
                $observations.Add(@{ kind = 'application'; product = $product; version = [string]$version })
            }
        }
    } finally { $uninstall.Dispose() }
}

try {
    foreach ($svc in (Get-Service -Name 'MSSQL*','SQLBrowser' -ErrorAction SilentlyContinue -ErrorVariable serviceErrors)) {
        $name = $svc.Name
        if ($name -eq 'SQLBrowser' -or $name -eq 'MSSQLSERVER' -or $name -match '^MSSQL\$') {
            $observations.Add(@{ kind = 'service'; name = $name; state = [string]$svc.Status })
        }
    }
    foreach ($err in $serviceErrors) {
        if ($err.FullyQualifiedErrorId -notlike 'NoServiceFoundForGivenName*') { [void]$issues.Add('services') }
    }
} catch { [void]$issues.Add('services') }

$views = @('Registry32')
if ([Environment]::Is64BitOperatingSystem) { $views += 'Registry64' }
foreach ($view in $views) {
    foreach ($hive in @('LocalMachine','CurrentUser')) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
        try {
            if ($hive -eq 'LocalMachine') {
                try { Read-Instances $base $view } catch { [void]$issues.Add('instance-registry') }
                try {
                    $drivers = $base.OpenSubKey('SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers')
                    if ($null -ne $drivers) {
                        try {
                            foreach ($name in $drivers.GetValueNames()) {
                                if ($name -match '^(ODBC Driver (11|13|17|18) for SQL Server|SQL Native Client|SQL Server Native Client (10|11)\.0|SQL Server)$' -and $drivers.GetValue($name) -eq 'Installed') {
                                    $observations.Add(@{ kind = 'driver'; name = $name; view = $view })
                                }
                            }
                        } finally { $drivers.Dispose() }
                    }
                    $localdb = $base.OpenSubKey("$sqlRoot Local DB\Installed Versions")
                    if ($null -ne $localdb) {
                        try {
                            if ($localdb.SubKeyCount -gt 0) { $observations.Add(@{ kind = 'localdb-runtime' }) }
                        } finally { $localdb.Dispose() }
                    }
                } catch { [void]$issues.Add('client-registry') }
            }
            try { Read-Applications $base } catch { [void]$issues.Add('applications') }
        } finally { $base.Dispose() }
    }
}

@{ schema = 1; observations = $observations.ToArray(); issues = @($issues) } | ConvertTo-Json -Depth 4 -Compress
