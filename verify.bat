@echo off
rem Galactic Syndicate - Vollstaendige Pruefung: install, typecheck, tests, build. Logs landen in .verify\
cd /d "%~dp0"
if not exist .verify mkdir .verify
echo [1/4] npm install ...
call npm install > .verify\install.log 2>&1
echo exit=%errorlevel% > .verify\install.exit
echo [2/4] typecheck ...
call npx tsc --noEmit > .verify\typecheck.log 2>&1
echo exit=%errorlevel% > .verify\typecheck.exit
echo [3/4] vitest ...
call npx vitest run > .verify\test.log 2>&1
echo exit=%errorlevel% > .verify\test.exit
echo [4/4] vite build ...
call npx vite build > .verify\build.log 2>&1
echo exit=%errorlevel% > .verify\build.exit
echo Fertig. Ergebnisse in .verify\
type .verify\*.exit
timeout /t 10
