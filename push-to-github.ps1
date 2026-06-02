# Gestaltung - push this project to a new GitHub repo.
# Requires the GitHub CLI: https://cli.github.com  (run 'gh auth login' once first)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (Test-Path ".git") { Remove-Item -Recurse -Force ".git" }
git init
git add .
git commit -m "Stage 1: scaffold + Gestaltung landing page"
git branch -M main
gh repo create gestaltung --public --source=. --remote=origin --push

Write-Host "==> Pushed. Now import the repo at https://vercel.com/new to enable auto-deploy." -ForegroundColor Green
Read-Host "Press Enter to close"
