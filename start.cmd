@echo off
rem Windows entry point: double-click or run `start.cmd` from a terminal.
rem Forwards all arguments to the Node launcher (scripts/start.mjs).
node "%~dp0scripts\start.mjs" %*
exit /b %ERRORLEVEL%
