@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title AstraFetch - Build Installer

if not exist "%CD%\scripts\ensure-node.ps1" (
  echo ERROR: Missing scripts\ensure-node.ps1.
  echo Extract the complete hotfix or source ZIP with file replacement enabled.
  goto :fail
)

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

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\ensure-dependencies.ps1"
if errorlevel 1 goto :fail

echo Checking local media binaries...
call "%CD%\.runtime\node\npm.cmd" run setup:binaries
if errorlevel 1 goto :fail

echo Running project checks and tests...
call "%CD%\.runtime\node\npm.cmd" run check
if errorlevel 1 goto :fail
call "%CD%\.runtime\node\npm.cmd" test
if errorlevel 1 goto :fail

echo Building x64 portable application and NSIS installer...
call "%CD%\.runtime\node\npm.cmd" run dist:win
if errorlevel 1 goto :fail

echo.
echo BUILD COMPLETED.
echo Output folder: "%CD%\dist"
explorer.exe "%CD%\dist"
pause
exit /b 0

:fail
echo.
echo BUILD FAILED. Review the error messages above.
pause
exit /b 1
