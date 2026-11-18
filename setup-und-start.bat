@echo off
rem Galactic Syndicate - Abhaengigkeiten installieren und Dev-Server starten
cd /d "%~dp0"
if not exist node_modules (
  echo Installiere Abhaengigkeiten ^(einmalig^)...
  call npm install || goto :fehler
)
echo Starte Dev-Server auf http://localhost:5173 ...
call npm run dev
goto :eof
:fehler
echo.
echo npm install ist fehlgeschlagen. Ist Node.js ^(>= 20^) installiert?
pause
