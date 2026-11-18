[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
)

$ErrorActionPreference = 'Stop'
$expected = '087BF7B1D433EED6AFCFB2F983DFED3381416EDF1E0DC6C7779B98C537F6D5B9'
$item = Get-Item -LiteralPath $LiteralPath
if ($item -isnot [System.IO.FileInfo]) { throw 'Select the SQL Server 2005 Express SP4 ENU installation file.' }
$digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash
if ($digest -ne $expected) { throw 'File does not match SQL Server 2005 Express SP4 ENU installation media.' }

$signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
    throw 'Windows did not validate the Microsoft Authenticode signature. Stop before installing.'
}
$publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if ($publisher -ne 'Microsoft Corporation') { throw 'Unexpected publisher.' }
[pscustomobject]@{ package = 'SQL Server 2005 Express SP4 ENU'; sha256 = $digest; signature = 'Valid'; publisher = $publisher }
