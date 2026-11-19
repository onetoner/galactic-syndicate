@echo off
rem Galactic Syndicate - Test auf einem per USB angeschlossenen Android-Geraet (Entwicklermodus / USB-Debugging).
rem Fuehrt die Zeilen aus .tablet\cmds.txt aus. Erlaubte Befehle (bewusst nur diese):
rem   adb <argumente>          beliebiger adb-Befehl an das angeschlossene Geraet
rem   apk <tag> <dateiname>    laedt die APK aus dem eigenen GitHub-Release nach .tablet\app.apk
rem   shot <name>              Screenshot nach .tablet\<name>.png
rem   logcat <name>            Geraete-Log nach .tablet\<name>.log
rem   sleep <sekunden>
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not exist .tablet mkdir .tablet
del /q .tablet\done.txt 2>nul
set OUT=.tablet\out.txt
echo ==== Lauf %date% %time% ==== > %OUT%

set "ADB=adb"
where adb >nul 2>nul
if errorlevel 1 (
  set "ADB="
  if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
  if not defined ADB if defined ANDROID_HOME if exist "%ANDROID_HOME%\platform-tools\adb.exe" set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
  if not defined ADB if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
)
if not defined ADB (
  echo FEHLER: adb nicht gefunden ^(weder im PATH noch im Android-SDK^). >> %OUT%
  goto :ende
)
echo adb: %ADB% >> %OUT%

if not exist .tablet\cmds.txt (
  echo FEHLER: .tablet\cmds.txt fehlt. >> %OUT%
  goto :ende
)

for /f "usebackq tokens=1,* delims= " %%a in (".tablet\cmds.txt") do (
  echo. >> %OUT%
  echo ^> %%a %%b >> %OUT%
  if /i "%%a"=="adb" (
    "%ADB%" %%b >> %OUT% 2>&1
  ) else if /i "%%a"=="shot" (
    "%ADB%" exec-out screencap -p > ".tablet\%%b.png"
  ) else if /i "%%a"=="logcat" (
    "%ADB%" logcat -d -v time > ".tablet\%%b.log" 2>&1
  ) else if /i "%%a"=="sleep" (
    timeout /t %%b /nobreak >nul
  ) else if /i "%%a"=="apk" (
    for /f "tokens=1,2" %%t in ("%%b") do (
      curl -L --fail -s -S -o ".tablet\app.apk" "https://github.com/onetoner/galactic-syndicate/releases/download/%%t/%%u" >> %OUT% 2>&1
      for %%s in (".tablet\app.apk") do echo APK: %%~zs Bytes >> %OUT%
    )
  ) else (
    echo UEBERSPRUNGEN: unbekannter Befehl %%a >> %OUT%
  )
)

:ende
echo fertig %date% %time% > .tablet\done.txt
endlocal
