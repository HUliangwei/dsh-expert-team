# e2e boot & run: self-heal web-e2e profile (package.json/cordis files get
# cleaned from TEMP), start DSH web-e2e on 3100, launch headless chrome on
# 9223, run cdp-e2e.cjs, then clean up. Usage: pwsh -File test/e2e-boot.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$h = Join-Path $env:TEMP "dsh-e2e-home"
$prof = Join-Path $h "profiles\web-e2e"
$log = Join-Path $h "server.log"
$errLog = Join-Path $h "server.err.log"
$out = Join-Path $PSScriptRoot "cdp-out"
$mainProf = Join-Path $env:USERPROFILE ".dsh\profiles\web-e2e"

# 1) profile self-heal: if package.json is missing (TEMP cleanup), copy the
#    minimal profile files from the main home (which has the same patches).
New-Item -ItemType Directory -Force -Path $prof | Out-Null
foreach ($f in @("package.json", "cordis.yml", "cordis.patch.yml")) {
    if (-not (Test-Path (Join-Path $prof $f)) -and (Test-Path (Join-Path $mainProf $f))) {
        Copy-Item (Join-Path $mainProf $f) (Join-Path $prof $f) -Force
        Write-Output "[e2e-boot] restored $f"
    }
}
if (-not (Test-Path (Join-Path $prof "package.json"))) { throw "web-e2e profile package.json missing and no main-home copy to restore" }

# 2) free ports & stale server
foreach ($port in 3100, 9223) {
    $l = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($l) { Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 800
Remove-Item $log, $errLog -ErrorAction SilentlyContinue

# 3) boot DSH web-e2e (background; inherits DSH_HOME; dsh is a .cmd shim so
#    run it inside a pwsh child that streams the same log style as manual runs)
$env:DSH_HOME = $h
$boot = "`$env:DSH_HOME='$h'; dsh --profile web-e2e --port 3100 --no-open 2>&1 | Tee-Object -FilePath '$log'"
$srv = Start-Process -FilePath "pwsh" -ArgumentList "-NoProfile", "-Command", $boot -WindowStyle Hidden -PassThru
Write-Output "[e2e-boot] server pid=$($srv.Id)"

# 4) wait for token
$tok = $null
for ($i = 0; $i -lt 180; $i++) {
    if (Test-Path $log) {
        $l = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($l -match "token=([A-Za-z0-9_-]+)") { $tok = $Matches[1]; break }
        if ($srv.HasExited) { break }
    }
    Start-Sleep -Milliseconds 400
}
if (-not $tok) {
    Write-Output "[e2e-boot] no token"; if (Test-Path $log) { Get-Content $log -Tail 15 }
    Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Output "[e2e-boot] token=$tok"

# 5) headless chrome on 9223
$c2 = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*remote-debugging-port=9223*" }
if (-not $c2) {
    Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--headless=new", "--remote-debugging-port=9223", "--user-data-dir=C:\Users\30360\AppData\Local\Temp\dsh-e2e-chrome2", "--no-first-run", "--disable-gpu", "about:blank" -WindowStyle Hidden
}
for ($i = 0; $i -lt 30; $i++) {
    try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:9223/json/version" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { break } } catch {}
    Start-Sleep -Milliseconds 400
}

# 6) run e2e
node (Join-Path $PSScriptRoot "cdp-e2e.cjs") 9223 $tok $out
$code = $LASTEXITCODE
$lm = Get-Content (Join-Path $out "local-marks.json") -Raw | ConvertFrom-Json
$bad = @(); $lm.PSObject.Properties | ForEach-Object { if ($_.Value -ne $true) { $bad += $_.Name } }
if ($bad.Count -eq 0) { Write-Output ("[e2e-boot] ALL MARKS TRUE (" + $lm.PSObject.Properties.Count + ")") } else { Write-Output ("[e2e-boot] FALSE: " + ($bad -join ", ")) }

# 7) cleanup: kill server (leave chrome for reuse)
Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
foreach ($port in 3100) {
    $l = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($l) { Stop-Process -Id $l.OwningProcess -Force -ErrorAction SilentlyContinue }
}
exit $code
