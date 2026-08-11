@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title AstraFetch - Fix Dependencies and Run

if not exist "%CD%\scripts\ensure-node.ps1" (
  echo ERROR: Missing scripts\ensure-node.ps1.
  echo Extract the complete hotfix into the AstraFetch project folder.
  goto :fail
)

if not exist "%CD%\scripts\ensure-dependencies.ps1" (
  echo ERROR: Missing scripts\ensure-dependencies.ps1.
  echo Extract the complete hotfix into the AstraFetch project folder.
  goto :fail
)

echo Preparing local Node.js...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\ensure-node.ps1"
if errorlevel 1 goto :fail

set "PATH=%CD%\.runtime\node;%PATH%"
set "npm_config_registry=https://registry.npmjs.org/"
set "NPM_CONFIG_REGISTRY=https://registry.npmjs.org/"
set "npm_config_userconfig=%CD%\.npmrc"
set "NPM_CONFIG_USERCONFIG=%CD%\.npmrc"
set "npm_config_cache=%CD%\.cache\npm"
set "ELECTRON_CACHE=%CD%\.cache\electron"
set "ELECTRON_BUILDER_CACHE=%CD%\.cache\electron-builder"
set "ELECTRON_MIRROR="
set "NPM_CONFIG_ELECTRON_MIRROR="
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "npm_config_electron_skip_binary_download="
set "NPM_CONFIG_ELECTRON_SKIP_BINARY_DOWNLOAD="
set "ELECTRON_OVERRIDE_DIST_PATH="
set "npm_config_electron_override_dist_path="
set "NPM_CONFIG_ELECTRON_OVERRIDE_DIST_PATH="

echo Removing the incomplete dependency tree and installing clean dependencies...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\ensure-dependencies.ps1" -ForceClean
if errorlevel 1 goto :fail

echo Checking local media binaries...
call "%CD%\.runtime\node\npm.cmd" run setup:binaries
if errorlevel 1 goto :fail

echo Starting AstraFetch...
call "%CD%\.runtime\node\npm.cmd" start
exit /b %errorlevel%

:fail
echo.
echo FAILED. Review the error messages above.
pause
exit /b 1
