@echo off
setlocal

if not exist ".venv\Scripts\python.exe" (
  echo Virtual environment not found. Running setup_windows_env.bat...
  call setup_windows_env.bat
  if %ERRORLEVEL% neq 0 exit /b 1
)

call .venv\Scripts\activate.bat
if %ERRORLEVEL% neq 0 exit /b 1

python -m pip install -r requirements.txt
if %ERRORLEVEL% neq 0 exit /b 1

pyinstaller --noconfirm --onefile --windowed --name OW2HeroBansGUI ^
  --add-data "assets;assets" ^
  --add-data "css;css" ^
  --add-data "data;data" ^
  --add-data "js;js" ^
  --add-data "team1.html;." ^
  --add-data "team2.html;." ^
  --add-data "control.html;." ^
  gui_tool.py

if %ERRORLEVEL% neq 0 exit /b 1

echo.
echo Build complete: dist\OW2HeroBansGUI.exe
endlocal
