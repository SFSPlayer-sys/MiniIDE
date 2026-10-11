@echo off
setlocal
cd /d %~dp0
cargo build --release || exit /b 1
set "UPXBIN=upx"
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\upx.exe" set "UPXBIN=%LOCALAPPDATA%\Microsoft\WinGet\Links\upx.exe"
"%UPXBIN%" --ultra-brute --lzma --no-progress --force --no-backup --overlay=strip target\release\MiniIDE.exe || exit /b 1
endlocal