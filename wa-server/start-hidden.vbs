' ============================================================
'  JJ Paper - Lanzador Silencioso en Segundo Plano
'  Ejecuta run-service.bat sin abrir ventana de consola negra.
' ============================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir
batPath = Chr(34) & strScriptDir & "\run-service.bat" & Chr(34)
WshShell.Run batPath, 0, False

Set WshShell = Nothing
Set FSO = Nothing
