' ============================================================
'  JJ Paper - Lanzador Silencioso del Puente MixNet
'  Ejecuta run-daemon.bat sin abrir ventana de consola.
' ============================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir
cmdLine = "cmd.exe /c " & Chr(34) & strScriptDir & "\run-daemon.bat" & Chr(34)
WshShell.Run cmdLine, 0, False

Set WshShell = Nothing
Set FSO = Nothing
