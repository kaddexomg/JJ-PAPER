' Inicia el servidor MixNet ERP en segundo plano sin ventana de consola
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "node server.js", 0, False
Set WshShell = Nothing
