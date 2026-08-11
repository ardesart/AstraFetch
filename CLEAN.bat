@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo Removing generated dependencies, caches, binaries, and builds...
rmdir /s /q "node_modules" 2>nul
rmdir /s /q ".cache" 2>nul
rmdir /s /q "dist" 2>nul
rmdir /s /q "vendor\bin" 2>nul
mkdir "vendor\bin" 2>nul
echo Clean completed. Local Node.js was preserved in .runtime.
pause
