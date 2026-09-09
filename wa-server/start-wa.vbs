' JJ Paper wa-server — lanzador oculto para Windows.
' Arranca el SUPERVISOR (START-SERVIDOR.bat) SIN ventana visible, así el
' "Reiniciar" del panel relanza el proceso solo. Usado por el Programador de
' tareas al iniciar sesión (ver README → arranque automático).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
curDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = curDir
sh.Run "cmd /c START-SERVIDOR.bat", 0, False
