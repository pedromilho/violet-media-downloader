@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if not exist ".venv\Scripts\python.exe" (
  echo Instale o Python 3.10 ou superior para continuar.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -c "import flask, yt_dlp, imageio_ffmpeg" >nul 2>&1
if errorlevel 1 ".venv\Scripts\python.exe" -m pip install -r requirements.txt
".venv\Scripts\python.exe" app.py
exit
