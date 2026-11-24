@echo off
rem Wait 30 seconds after Windows starts, then launch A-eye MCP hub server
timeout /t 30 > D:\temp\delay.log
set AEYE_BIND=0.0.0.0&& node "%~dp0dist\aeye.cjs" serve
