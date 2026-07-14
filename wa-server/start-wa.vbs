' JJ Paper wa-server — lanzador oculto para Windows.
' Arranca "npm start" (node src/index.js) SIN ventana visible.
' Usado por el Programador de tareas al iniciar sesión (ver README).
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\PC\Desktop\JJ PAPER\wa-server"
' 0 = ventana oculta ; False = no esperar a que termine
sh.Run "cmd /c npm start", 0, False
