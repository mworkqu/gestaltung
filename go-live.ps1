# Gestaltung - Stage 1: get the site LIVE on Vercel
# Run: right-click this file > "Run with PowerShell", or double-click GO-LIVE.bat

# Do NOT let native-command exit codes abort the script - we check them ourselves.
$ErrorActionPreference = "Continue"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

Set-Location $PSScriptRoot
Write-Host "==> Project folder: $PSScriptRoot" -ForegroundColor Cyan

# Clean up leftovers / force a fresh, secure dependency resolve
try { if (Test-Path ".git")              { Remove-Item -Recurse -Force ".git" } }              catch {}
try { if (Test-Path ".vercel")           { Remove-Item -Recurse -Force ".vercel" } }           catch {}
try { if (Test-Path "node_modules")      { Remove-Item -Recurse -Force "node_modules" } }      catch {}
try { if (Test-Path "package-lock.json") { Remove-Item -Force "package-lock.json" } }          catch {}
foreach ($f in @("__deltest.txt","__ow.txt")) { try { if (Test-Path $f) { Remove-Item -Force $f } } catch {} }

# 1) Node check
$nodeV = (node -v) 2>$null
if (-not $nodeV) {
  Write-Host "Node.js is not installed. Get the LTS from https://nodejs.org , then run this again." -ForegroundColor Red
  Read-Host "Press Enter to exit"; exit 1
}
Write-Host "==> Node $nodeV detected" -ForegroundColor Green

# 2) Install dependencies (fresh) - pulls the patched Next.js 15.x
Write-Host "==> npm install (fresh download, ~1-2 min)..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed (see above)." -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
$nextV = (npm ls next --depth=0) 2>$null | Select-String "next@"
Write-Host "==> Installed $nextV" -ForegroundColor Green

# 3) Make sure we have a valid Vercel login
Write-Host "==> Checking Vercel login..." -ForegroundColor Cyan
$who = (npx --yes vercel whoami) 2>$null
if (-not $who) {
  npx --yes vercel logout 2>$null
  Write-Host "==> Logging in to Vercel - a prompt/browser will open." -ForegroundColor Cyan
  Write-Host "    Choose the account you use for Vercel (e.g. 'Continue with GitHub', or email gestaltung.co@gmail.com)." -ForegroundColor DarkGray
  npx --yes vercel login
  if ($LASTEXITCODE -ne 0) { Write-Host "Login did not complete. Re-run GO-LIVE.bat." -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
} else {
  Write-Host "==> Logged in as $who" -ForegroundColor Green
}

# 4) Ensure the Vercel project exists (valid name 'gestaltung')
Write-Host "==> Ensuring Vercel project 'gestaltung' exists..." -ForegroundColor Cyan
npx --yes vercel project add gestaltung
# If it already exists this returns an error - that's fine, we continue.

# 5) Deploy to production, targeting that project
Write-Host "==> Deploying to production as project 'gestaltung'..." -ForegroundColor Cyan
npx --yes vercel --prod --yes --project gestaltung
if ($LASTEXITCODE -ne 0) {
  Write-Host "Deploy failed (see the messages above). Copy the output and send it to Claude." -ForegroundColor Red
  Read-Host "Press Enter to exit"; exit 1
}

Write-Host ""
Write-Host "==> DONE. Your public URL (https://gestaltung*.vercel.app) is printed just above." -ForegroundColor Green
Read-Host "Press Enter to close"
