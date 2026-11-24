# Aeye project memory (A-eye / Artificial Eye, formerly BrowserBridgeExt)

- MCP server `aeye` tools: `tabs`, `nav`, `read` (compact element list), `act`, `shot`, `js`, `logs`, `gif` (open pages, read, click, screenshots, console and network logs). Its hub listens on 127.0.0.1:47821.
- Aeye Hub is started by a Windows scheduled task after logon (2 min delay, port 47821). If it is down, check `Get-ScheduledTask` for **Aeye Hub** and `Start-ScheduledTask` it; do not look elsewhere.
- The Aeye Hub action must stay `conhost.exe --headless cmd.exe /c start "" /b <start-aeye.cmd>`; running the .cmd directly makes the hub exit at once. Keep one action per task, because a second action never starts behind one that does not end.
