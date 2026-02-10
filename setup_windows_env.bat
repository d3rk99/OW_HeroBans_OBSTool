@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "PYTHON_CMD="
set "WINGET_OK="

call :detect_python
if defined PYTHON_CMD goto :python_ready

echo Python was not found. Attempting install with winget...
where winget >nul 2>&1
if %ERRORLEVEL%==0 (
  set "WINGET_OK=1"
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  if %ERRORLEVEL%==0 (
    call :detect_python
    if defined PYTHON_CMD goto :python_ready
  )
  echo winget install did not result in a usable python command.
)

echo Attempting fallback install using official Python installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $url='https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe'; $out=Join-Path $env:TEMP 'python-installer.exe'; Invoke-WebRequest -Uri $url -OutFile $out; Start-Process -FilePath $out -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1' -Wait"
if %ERRORLEVEL% neq 0 (
  echo Failed to install Python using fallback installer.
  if not defined WINGET_OK (
    echo winget is not available in this environment.
  )
  exit /b 1
)

call :detect_python
if not defined PYTHON_CMD (
  echo Python is still unavailable after install attempts.
  exit /b 1
)

:python_ready
echo Using Python command: %PYTHON_CMD%

if not exist ".venv" (
  call %PYTHON_CMD% -m venv .venv
  if %ERRORLEVEL% neq 0 (
    echo Failed to create virtual environment.
    exit /b 1
  )
)

call .venv\Scripts\activate.bat
if %ERRORLEVEL% neq 0 (
  echo Failed to activate virtual environment.
  exit /b 1
)

python -m pip install --upgrade pip
if %ERRORLEVEL% neq 0 (
  echo Failed to upgrade pip.
  exit /b 1
)

python -m pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
  echo Failed to install dependencies.
  exit /b 1
)

echo.
echo Environment setup complete.
echo To build the executable, run: build_exe.bat

endlocal
exit /b 0

:detect_python
set "PYTHON_CMD="
where py >nul 2>&1
if %ERRORLEVEL%==0 (
  set "PYTHON_CMD=py -3"
  exit /b 0
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  set "PYTHON_CMD=python"
)
exit /b 0
