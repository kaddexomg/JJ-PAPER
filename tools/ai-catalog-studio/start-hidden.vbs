Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir
WshShell.Run "cmd.exe /c run-studio.bat", 0, False
Set WshShell = Nothing
Set FSO = Nothing
