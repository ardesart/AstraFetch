@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "REPO=https://github.com/ardesart/AstraFetch.git"
set "BRANCH=main"

echo.
echo ========================================
echo   AstraFetch - Update from GitHub
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo ERROR: Git was not found in PATH.
    echo Install Git for Windows or add git.exe to PATH.
    goto :fail
)

if not exist ".git\" (
    echo This folder is not a Git working copy yet.
    echo Initializing repository connection...
    git init
    if errorlevel 1 goto :fail
    git remote add origin "%REPO%"
    if errorlevel 1 goto :fail
    git fetch --prune origin "%BRANCH%"
    if errorlevel 1 goto :fail
    git reset --hard "origin/%BRANCH%"
    if errorlevel 1 goto :fail
) else (
    git remote get-url origin >nul 2>nul
    if errorlevel 1 (
        git remote add origin "%REPO%"
        if errorlevel 1 goto :fail
    ) else (
        git remote set-url origin "%REPO%"
        if errorlevel 1 goto :fail
    )

    echo Downloading latest changes...
    git fetch --prune origin "%BRANCH%"
    if errorlevel 1 goto :fail

    echo Updating project files to origin/%BRANCH%...
    git reset --hard "origin/%BRANCH%"
    if errorlevel 1 goto :fail
)

echo.
echo Update completed successfully.
echo Local runtime, downloaded binaries, caches and user data are preserved when ignored by Git.
echo.
pause
exit /b 0

:fail
echo.
echo UPDATE FAILED. Review the messages above.
echo.
pause
exit /b 1
