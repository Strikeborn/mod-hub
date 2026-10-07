@echo off
start "Mod Hub agent watcher" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-watch.ps1"
