' JJ Paper wa-server — lanzador oculto para Windows.
' Arranca el SUPERVISOR (START-SERVIDOR.bat) SIN ventana visible, así el
' "Reiniciar" del panel relanza el proceso solo. Usado por el Programador de
' tareas al iniciar sesión (ver README → arranque automático).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\PC\Desktop\JJ PAPER\wa-server"
' 0 = ventana oculta ; False = no esperar a que termine
sh.Run "cmd /c START-SERVIDOR.bat", 0, False
