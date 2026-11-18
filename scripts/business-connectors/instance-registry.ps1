function Read-Value($base, $path, $name) {
    $key = $base.OpenSubKey($path)
    if ($null -eq $key) { return }
    try { $key.GetValue($name, $null, 'DoNotExpandEnvironmentNames') }
    finally { $key.Dispose() }
}

function Read-Instances($base, $view, $observations, $issues) {
    $sqlRoot = 'SOFTWARE\Microsoft\Microsoft SQL Server'
    $instancePattern = '^[A-Za-z0-9_#$-]{1,16}$'
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
