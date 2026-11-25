@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto deps
py -3.12 -m venv ".venv"
if errorlevel 1 goto setupfail
:deps
if exist ".venv\folio-ready" goto launch
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto setupfail
echo ready>".venv\folio-ready"
:launch
".venv\Scripts\python.exe" -m streamlit run streamlit_app.py
if errorlevel 1 goto setupfail
exit /b
:setupfail
echo.
echo Check that Python 3.12 and its launcher are installed. See README.md for manual setup.
pause
exit /b 1
