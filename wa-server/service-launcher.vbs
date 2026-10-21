Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Supervisor\.jj-paper\wa-server"
WshShell.Run "cmd.exe /c run-service.bat", 0, False
Set WshShell = Nothing
