' ============================================================
'  JJ Paper - Lanzador Silencioso en Segundo Plano
'  Ejecuta run-service.bat sin abrir ventana de consola negra.
' ============================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir
cmdLine = "cmd.exe /c """ & strScriptDir & "\run-service.bat"""
WshShell.Run cmdLine, 0, False

Set WshShell = Nothing
Set FSO = Nothing
