# Gestaltung - run locally at http://localhost:3000  (Ctrl+C to stop)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path "node_modules")) { Write-Host "==> npm install..." -ForegroundColor Cyan; npm install }
Write-Host "==> Starting dev server at http://localhost:3000" -ForegroundColor Green
npm run dev
