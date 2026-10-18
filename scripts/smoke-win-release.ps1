param(
  [string]$ReleaseDir = "release",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$releasePath = Join-Path $root $ReleaseDir
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$unpackedExe = Join-Path $releasePath "win-unpacked\XLB Storyboard.exe"
$portableExe = Get-ChildItem -Path $releasePath -Filter "*.exe" |
  Where-Object { $_.Name -match [regex]::Escape($version) -and $_.Name -notmatch "Setup" } |
  Select-Object -First 1

if (-not (Test-Path $unpackedExe)) {
  throw "Windows unpacked app not found: $unpackedExe"
}
if (-not $portableExe) {
  throw "Windows portable EXE not found for version $version"
}

function Test-PackagedRuntime([string]$Executable, [string]$Label) {
  $expectedMarker = "XLB_STORYBOARD_PACKAGED_RUNTIME_OK"
  $tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
  $markerPath = Join-Path $tempRoot ("xlb-smoke-" + [guid]::NewGuid().ToString("N") + ".txt")
  $previousMarker = $env:XLB_STORYBOARD_SMOKE_MARKER
  try {
    $env:XLB_STORYBOARD_SMOKE_MARKER = $markerPath
    $process = Start-Process -FilePath $Executable -ArgumentList "--smoke-test" -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $result = $null
    while ((Get-Date) -lt $deadline) {
      if (Test-Path $markerPath) {
        $content = Get-Content -LiteralPath $markerPath -Raw -ErrorAction SilentlyContinue
        if ($null -ne $content) {
          $result = $content.Trim()
          if ($result -eq $expectedMarker) { break }
        }
      }
      if ($process.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
    if ($result -ne $expectedMarker) {
      if (-not $process.HasExited) { $process.Kill() }
      if ([string]::IsNullOrWhiteSpace($result)) {
        throw "$Label exited or timed out without a runtime marker"
      }
      throw "$Label returned an invalid runtime marker: $result"
    }
    Write-Host "[smoke:win-release] passed: $Label"
  }
  finally {
    $env:XLB_STORYBOARD_SMOKE_MARKER = $previousMarker
    Remove-Item $markerPath -Force -ErrorAction SilentlyContinue
  }
}

Test-PackagedRuntime $unpackedExe "win-unpacked/XLB Storyboard.exe"
Test-PackagedRuntime $portableExe.FullName $portableExe.Name

$signatureStatus = "NotSigned"
Write-Host "[smoke:win-release] Authenticode: $signatureStatus (no Windows signing certificate configured)"

$stream = [System.IO.File]::OpenRead($portableExe.FullName)
$sha256 = $null
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $hashBytes = $sha256.ComputeHash($stream)
  $hashValue = [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
}
finally {
  if ($sha256) { $sha256.Dispose() }
  $stream.Dispose()
}
$buildInfo = @(
  "file=$($portableExe.Name)"
  "size=$($portableExe.Length)"
  "sha256=$hashValue"
  "authenticode=$signatureStatus"
) -join "`n"
[System.IO.File]::WriteAllText(
  (Join-Path $releasePath "windows-build-info.txt"),
  $buildInfo,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host $buildInfo
