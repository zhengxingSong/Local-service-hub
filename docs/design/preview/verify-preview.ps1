# Preview acceptance: static checks + headless interaction probe.
#
#   .\verify-preview.ps1 -File .\ui-preview.html
#   .\verify-preview.ps1 -File .\ui-v1-taste.html -Width 900 -Height 700
#
# Probe output is written into <pre id="probeout"> by the script that
# verify-preview.mjs injects, because Chrome --dump-dom does not emit console.
# ASCII-only on purpose: Windows PowerShell reads .ps1 as ANSI when there is no
# BOM, so non-ASCII comments can corrupt the parse.
param(
  [Parameter(Mandatory = $true)][string]$File,
  [int]$Width = 1440,
  [int]$Height = 900
)
$ErrorActionPreference = 'Stop'
$node   = 'C:\Users\7\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$File   = (Resolve-Path -LiteralPath $File).Path

Write-Host "=== static checks: $(Split-Path $File -Leaf) ===" -ForegroundColor Cyan
$static = & $node (Join-Path $here 'verify-preview.mjs') $File --inject-probe 2>&1 | Out-String
$static -split "`n" | Where-Object { $_ -notmatch '^PROBE_FILE=' } | ForEach-Object { $_ }

$probe = [regex]::Match($static, 'PROBE_FILE=(.+)').Groups[1].Value.Trim()
if (-not $probe -or -not (Test-Path -LiteralPath $probe)) {
  Write-Host 'probe copy was not produced; skipping interaction checks' -ForegroundColor Red
  exit 1
}

Write-Host "`n=== interaction probe: ${Width}x${Height} ===" -ForegroundColor Cyan
$url = 'file:///' + ($probe -replace '\\', '/')
$dom = & $chrome --headless=new --disable-gpu --no-sandbox "--window-size=$Width,$Height" `
  --virtual-time-budget=6000 --dump-dom $url 2>$null | Out-String
$m = [regex]::Match($dom, '<pre id="dshverifyout">([\s\S]*?)</pre>')
if (-not $m.Success) {
  Write-Host 'no probe output found (script did not run or threw)' -ForegroundColor Red
  exit 1
}

$pass = 0; $fail = 0; $miss = 0
foreach ($line in ($m.Groups[1].Value -split "`n")) {
  $t = $line.Trim(); if (-not $t) { continue }
  if ($t -like 'PASS*') { $pass++; Write-Host "  $t" -ForegroundColor Green }
  elseif ($t -like 'FAIL*') { $fail++; Write-Host "  $t" -ForegroundColor Red }
  elseif ($t -like 'MISS*') { $miss++; Write-Host "  $t" -ForegroundColor Yellow }
  else { Write-Host "  $t" }
}
$verdict = if ($fail -eq 0) { 'PASS' } else { 'FAIL' }
$color = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "`nverdict: $verdict  | pass $pass | fail $fail | missing $miss" -ForegroundColor $color
Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
if ($fail -gt 0) { exit 1 }
