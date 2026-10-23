@echo off
rem Starts the A-eye hub headlessly (no stdin needed); MCP sessions and browsers attach to it.
node "%~dp0dist\aeye.cjs" serve
