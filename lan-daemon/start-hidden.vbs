' ============================================================
'  JJ Paper - Puente Soberano MixNet & Servidor de Servicios
'  Redirige de forma transparente al iniciador moderno de produccion
' ============================================================
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Supervisor"
WshShell.Run "cmd.exe /c C:\Users\Supervisor\start_all.bat", 0, False
Set WshShell = Nothing
