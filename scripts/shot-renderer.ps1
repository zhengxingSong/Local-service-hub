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
  [int]$Port = 8791
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

$py = 'C:\Users\7\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $py))     { throw "python not found: $py" }
if (-not (Test-Path $chrome)) { throw "chrome not found: $chrome" }

$srv = Start-Process -FilePath $py -ArgumentList '-m', 'http.server', "$Port", '--bind', '127.0.0.1' `
  -WorkingDirectory $dist -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 2
  $url = "http://127.0.0.1:$Port/_verify.html"
  $probe = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
  Write-Host "server ready: HTTP $($probe.StatusCode)  $url" -ForegroundColor Cyan
  Remove-Item $Out -Force -ErrorAction SilentlyContinue
  # Chrome writes "N bytes written to file ..." on stderr; with
  # $ErrorActionPreference='Stop' PowerShell turns that into a terminating
  # NativeCommandError, so relax it around this native call only.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 `
    "--window-size=$Width,$Height" --virtual-time-budget=9000 "--screenshot=$Out" $url 2>&1 | Out-Null
  $ErrorActionPreference = $prevEap
  if (Test-Path $Out) {
    Write-Host ("screenshot: {0}  {1} KB" -f $Out, [math]::Round((Get-Item $Out).Length / 1KB, 0)) -ForegroundColor Green
  } else {
    throw "screenshot was not produced"
  }
} finally {
  Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $verify -Force -ErrorAction SilentlyContinue
  Write-Host "server stopped (pid $($srv.Id)); temp verify page removed" -ForegroundColor DarkGray
}
