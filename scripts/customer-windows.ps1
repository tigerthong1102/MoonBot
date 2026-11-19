[CmdletBinding()]
param(
  [Parameter(Mandatory, Position=0)][ValidateSet('preflight','build','verify','accept')][string]$Action,
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Thumbprint,
  [string]$Installer
)
$ErrorActionPreference = 'Stop'

# PowerShell 7 can pass its module search path to a Windows PowerShell 5.1 child.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop

function Confirm-Signature([string]$File) {
  $signature = Get-AuthenticodeSignature -LiteralPath $File
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $Thumbprint) {
    throw "Expected a trusted signature from publisher certificate $Thumbprint on $File (status $($signature.Status))."
  }
  if ((Get-Item -LiteralPath $File).VersionInfo.ProductName -ne 'StartupBot') { throw "Unexpected product on $File." }
  if (-not $signature.TimeStamperCertificate) { throw "Missing signature timestamp on $File." }
}

if ($Action -in 'verify','accept') {
  if (-not $Installer) { throw 'Specify -Installer with the path to the NSIS installer.' }
  $image = Get-Item -LiteralPath $Installer
  Confirm-Signature $image.FullName
  if ($Action -eq 'verify') { return }

  $scratch = Join-Path ([IO.Path]::GetTempPath()) ('startupbot-accept-' + [guid]::NewGuid().ToString('N'))
  $installed = Join-Path $scratch 'app'
  New-Item -ItemType Directory -Path $scratch | Out-Null
  $process = Start-Process -FilePath $image.FullName -ArgumentList '/S',"/D=$installed" -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "NSIS installation failed (exit $($process.ExitCode))." }
  $app = Join-Path $installed 'StartupBot.exe'
  Confirm-Signature $app
  & node (Join-Path $PSScriptRoot 'smoke-internal-desktop.mjs') --app $app --output (Join-Path $scratch 'smoke')
  if ($LASTEXITCODE -ne 0) { throw 'Installed desktop failed its launch test.' }
  $customer = New-Item -ItemType Directory -Path (Join-Path $scratch 'customer')
  $file = Copy-Item -LiteralPath $image.FullName -Destination $customer.FullName -PassThru
  Confirm-Signature $file.FullName
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../docs/startupbot/install-windows.vi.md') -Destination (Join-Path $customer.FullName 'HUONG-DAN.md')
  Set-Content -LiteralPath (Join-Path $customer.FullName 'SHA256SUMS.txt') -Encoding ascii -Value "$hash  $($file.Name)"
  Write-Output "Customer files: $($customer.FullName)"
  return
}
$cert = Get-ChildItem Cert:\CurrentUser\My,Cert:\LocalMachine\My -CodeSigningCert |
  Where-Object { $_.Thumbprint -eq $Thumbprint -and $_.HasPrivateKey -and $_.NotBefore -le (Get-Date) -and $_.NotAfter -gt (Get-Date) } |
  Select-Object -First 1
if (-not $cert) { throw 'The selected code-signing certificate and private key are unavailable.' }
if ($Action -eq 'preflight') { return }

function Invoke-Pnpm {
  & pnpm.cmd @args
  if ($LASTEXITCODE -ne 0) { throw "pnpm command failed (exit $LASTEXITCODE)." }
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
  $out = Join-Path (Get-Location).Path ('release/signing-win-' + [guid]::NewGuid().ToString('N'))
  Invoke-Pnpm install --frozen-lockfile
  Invoke-Pnpm package:prepare
  Invoke-Pnpm build:cua:win
  $env:STARTUPBOT_SIGNED_ARCH = 'x64'
  $env:STARTUPBOT_SIGNED_PUBLISHER = $cert.Subject
  Invoke-Pnpm exec electron-builder --config electron-builder.updates.cjs --win nsis --x64 --publish never "-c.directories.output=$out" "-c.win.signtoolOptions.certificateSha1=$Thumbprint"
  $images = @(Get-ChildItem -LiteralPath $out -File -Filter '*-setup.exe')
  if ($images.Count -ne 1) { throw 'Expected one NSIS installer.' }
  Confirm-Signature $images[0].FullName
  Confirm-Signature (Join-Path $out 'win-unpacked/StartupBot.exe')
  & node scripts/desktop-update-manifest.mjs $out win32 x64
  if ($LASTEXITCODE -ne 0) { throw 'Invalid Windows update manifest.' }
  Write-Output "Signed installer for clean-machine acceptance: $($images[0].FullName)"
} finally {
  Pop-Location
}
