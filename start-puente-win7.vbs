' ============================================================
'  JJ Paper - Lanzador Silencioso del Puente MixNet (Win 7)
'  Ejecuta puente-mixnet-autonomo.cjs sin ventana de consola.
' ============================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strScriptDir

' Buscar node.exe
strNode = "node"
If FSO.FileExists("C:\Program Files\nodejs\node.exe") Then
    strNode = """C:\Program Files\nodejs\node.exe"""
ElseIf FSO.FileExists("C:\Program Files (x86)\nodejs\node.exe") Then
    strNode = """C:\Program Files (x86)\nodejs\node.exe"""
End If

WshShell.Run "cmd.exe /c " & strNode & " puente-mixnet-autonomo.cjs >> logs\puente-win7.log 2>&1", 0, False

Set WshShell = Nothing
Set FSO = Nothing
