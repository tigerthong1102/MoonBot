function Get-AuditLocalPath([string]$path) {
    if ([string]::IsNullOrWhiteSpace($path) -or $path -match '^[\\/]{2}') { throw 'AUDIT_LOCAL_PATH_REQUIRED' }
    $full = [IO.Path]::GetFullPath($path)
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $root = [IO.Path]::GetPathRoot($full)
        if ($root -notmatch '^[a-z]:\\$' -or $full.Substring($root.Length).Contains(':')) { throw 'AUDIT_LOCAL_PATH_REQUIRED' }
        $drive = [IO.DriveInfo]::new($root)
        if ($drive.DriveType -notin @('Fixed','Removable','Ram')) { throw 'AUDIT_LOCAL_PATH_REQUIRED' }
        $current = $root
        foreach ($part in $full.Substring($root.Length).Split([char]'\')) {
            $current = [IO.Path]::Combine($current, $part)
            try { $attributes = [IO.File]::GetAttributes($current) }
            catch [IO.FileNotFoundException] { break }
            catch [IO.DirectoryNotFoundException] { break }
            if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'AUDIT_LOCAL_PATH_REQUIRED' }
        }
    }
    return $full
}
