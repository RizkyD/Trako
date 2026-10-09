@echo off
rem Started hidden by the scheduled task Trako (see install-service.ps1) as
rem   service.cmd <node executable> <port> [proxy]
rem Runs the server in production mode, appending its output to logs\trako.log.
rem "proxy": a reverse proxy runs on this PC, so listen on 127.0.0.1 and trust it.
cd /d "%~dp0.."
if not exist logs mkdir logs
set "NODE_ENV=production"
set "PORT=%~2"
if "%~3"=="proxy" set "HOST=127.0.0.1"
if "%~3"=="proxy" set "TRUST_PROXY=1"
rem server.ts by its full path, which uninstall-service.ps1 looks for.
"%~1" --import remix/node-tsx "%CD%\server.ts" >> logs\trako.log 2>&1
