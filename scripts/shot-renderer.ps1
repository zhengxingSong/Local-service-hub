# Screenshot the REAL renderer (built app shell) headlessly.
#
#   .\shot-renderer.ps1                      -> dist\renderer\..\shots\real-app.png
#   .\shot-renderer.ps1 -Out C:\tmp\a.png -Width 1440 -Height 900
#
# Why this exists: the agent cannot see images, so the only way to verify the
# product's visual layer is to render the built bundle, stub window.serviceHubApi,
# screenshot it, and measure pixels (Canvas/CSS token proportions).
#
# Why HTTP and not file://: Chrome refuses <script type="module"> over file://
# (CORS), which renders a blank white page. Electron allows file://; browsers do not.
#
# ASCII-only on purpose: Windows PowerShell reads .ps1 as ANSI without a BOM, so
# non-ASCII comments break parsing.
param(
  [string]$Out,
  [int]$Width = 1440,
  [int]$Height = 900,
  [int]$Port = 8791,
  [switch]$Probe
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist = Join-Path $root 'dist\renderer'
$tpl  = Join-Path $root 'scripts\renderer-verify.template.html'
$index = Join-Path $dist 'index.html'

if (-not (Test-Path $index)) { throw "dist/renderer/index.html not found - run: pnpm run build:renderer" }
if (-not (Test-Path $tpl))   { throw "template not found: $tpl" }

$idx = [System.IO.File]::ReadAllText($index, [System.Text.Encoding]::UTF8)
$js  = [regex]::Match($idx, 'src="\./assets/([^"]+)"').Groups[1].Value
$css = [regex]::Match($idx, 'href="\./assets/([^"]+)"').Groups[1].Value
if (-not $js -or -not $css) { throw "could not read hashed asset names from $index" }

$page = [System.IO.File]::ReadAllText($tpl, [System.Text.Encoding]::UTF8).Replace('__JS__', $js).Replace('__CSS__', $css)
$verify = Join-Path $dist '_verify.html'
[System.IO.File]::WriteAllText($verify, $page, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "verify page: $verify  (js=$js css=$css)" -ForegroundColor Cyan

if (-not $Out) { $Out = Join-Path $root 'docs\design\preview\shots\7-real-app-carbon.png' }
$Out = [System.IO.Path]::GetFullPath($Out)

# Locate Python and Chrome: env override first, then PATH, then known local paths.
# Env overrides keep this working on machines whose paths differ; the local paths
# are only a last-resort fallback. This file stays ASCII-only on purpose:
# Windows PowerShell reads .ps1 as ANSI unless it has a BOM, so non-ASCII text here
# corrupts strings and breaks parsing.
function Resolve-Tool {
  param([string]$Override, [string[]]$Candidates, [string]$Exe)
  if ($Override -and (Test-Path $Override)) { return $Override }
  foreach ($c in $Candidates) { if ($c -and (Test-Path $c)) { return $c } }
  $cmd = Get-Command $Exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$py = Resolve-Tool -Override $env:DSH_PYTHON -Exe 'python' -Candidates @(
  'C:\Users\7\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe',
  "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
)
$chrome = Resolve-Tool -Override $env:DSH_CHROME -Exe 'chrome' -Candidates @(
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
if (-not $py) {
  throw "python not found. Install one, or set `$env:DSH_PYTHON (the script needs it to serve the build over HTTP)."
}
if (-not $chrome) {
  throw "chrome not found. Install it, or set `$env:DSH_CHROME. Chrome refuses <script type=module> over file:// (CORS), so this must go through HTTP."
}
Write-Host "python: $py" -ForegroundColor DarkGray
Write-Host "chrome: $chrome" -ForegroundColor DarkGray

$srv = Start-Process -FilePath $py -ArgumentList '-m', 'http.server', "$Port", '--bind', '127.0.0.1' `
  -WorkingDirectory $dist -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 2
  $url = "http://127.0.0.1:$Port/_verify.html"
  # NOTE: do not name this $probe - PowerShell variables are case-insensitive and
  # it would collide with the [switch]$Probe parameter.
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
  Write-Host "server ready: HTTP $($resp.StatusCode)  $url" -ForegroundColor Cyan
  Remove-Item $Out -Force -ErrorAction SilentlyContinue
  # Chrome writes "N bytes written to file ..." on stderr; with
  # $ErrorActionPreference='Stop' PowerShell turns that into a terminating
  # NativeCommandError, so relax it around this native call only.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 `
    "--window-size=$Width,$Height" --virtual-time-budget=20000 "--screenshot=$Out" $url 2>&1 | Out-Null
  $ErrorActionPreference = $prevEap
  if (Test-Path $Out) {
    Write-Host ("screenshot: {0}  {1} KB" -f $Out, [math]::Round((Get-Item $Out).Length / 1KB, 0)) -ForegroundColor Green
  } else {
    throw "screenshot was not produced"
  }

  if ($Probe) {
    Write-Host "`n=== structure probe ===" -ForegroundColor Cyan
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $domFile = Join-Path $env:TEMP 'dsh-renderer-dom.html'
    & $chrome --headless=new --disable-gpu --no-sandbox --virtual-time-budget=20000 --dump-dom $url 2>$null |
      Set-Content -LiteralPath $domFile -Encoding UTF8
    $dom = Get-Content -LiteralPath $domFile -Raw
    Remove-Item $domFile -Force -ErrorAction SilentlyContinue
    $ErrorActionPreference = $eap
    $m = [regex]::Match($dom, '<pre id="dshverifyout">([\s\S]*?)</pre>')
    if (-not $m.Success) { throw "probe output not found - the probe script did not run" }
    $pass = 0; $fail = 0; $miss = 0
    foreach ($line in ($m.Groups[1].Value -split "`n")) {
      $t = $line.Trim(); if (-not $t) { continue }
      if ($t -like 'PASS*') { $pass++; Write-Host "  $t" -ForegroundColor Green }
      elseif ($t -like 'FAIL*') { $fail++; Write-Host "  $t" -ForegroundColor Red }
      elseif ($t -like 'MISS*') {
        # 找不到控件也是失败：否则探针会在什么都没测到的情况下报绿
        $miss++; Write-Host "  $t" -ForegroundColor Red
      }
      else { Write-Host "  $t" }
    }
    if ($fail -eq 0 -and $miss -eq 0) {
      Write-Host "verdict: PASS | pass $pass | fail 0" -ForegroundColor Green
    } else {
      Write-Host "verdict: FAIL | pass $pass | fail $fail | miss $miss" -ForegroundColor Red
      $probeFailed = $true
    }
  }
} finally {
  Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $verify -Force -ErrorAction SilentlyContinue
  Write-Host "server stopped (pid $($srv.Id)); temp verify page removed" -ForegroundColor DarkGray
}
if ($probeFailed) { exit 1 }
