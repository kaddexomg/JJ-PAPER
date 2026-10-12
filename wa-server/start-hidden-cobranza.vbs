' ============================================================
'  JJ Paper - Lanzador Silencioso PC Cobranza (Windows 7)
'  Ejecuta run-cobranza-service.bat de forma 100% invisible.
' ============================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir
WshShell.Run "cmd.exe /c run-cobranza-service.bat", 0, False

Set WshShell = Nothing
Set FSO = Nothing
