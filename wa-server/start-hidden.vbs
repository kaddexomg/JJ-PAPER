' ============================================================
'  JJ Paper - Lanzador Silencioso en Segundo Plano
'  Ejecuta run-service.bat sin abrir ventana de consola negra.
' ============================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
strBatPath = strScriptDir & "\run-service.bat"

If FSO.FileExists(strBatPath) Then
    ' WindowStyle 0 = Oculto / Invisible
    ' WaitOnReturn False = No bloquear
    WshShell.CurrentDirectory = strScriptDir
    WshShell.Run Chr(34) & strBatPath & Chr(34), 0, False
End If
Set WshShell = Nothing
Set FSO = Nothing
