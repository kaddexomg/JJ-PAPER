# Guía Maestra: Acceso Remoto Seguro a la PC del Supervisor (MixNet ERP)

Esta guía permite al administrador controlar remotamente la **PC del Supervisor de la Tienda** desde su **Laptop personal**, sin importar dónde se encuentre y sin depender de abrir puertos en el módem de la tienda (atraviesa CANTV, fibra óptica y redes con IP dinámica mediante **Tailscale** cifrado con WireGuard).

---

## 🖥️ PARTE 1: En la PC del Supervisor (Tienda / Oficina)
*(Instrucciones para el Agente u Operador que esté físicamente en la tienda o por AnyDesk)*

### Paso 1: Actualizar el Repositorio
Abre la consola (CMD o PowerShell) en la carpeta del proyecto y descarga las herramientas:
```cmd
cd "C:\Users\PC\Desktop\JJ PAPER"
git pull origin main
```

### Paso 2: Ejecutar el Configurador Remoto Automático
1. Ve a la carpeta `wa-server`.
2. Haz clic derecho sobre **`CONFIGURAR-ACCESO-REMOTO-SUPERVISOR.bat`** y selecciona **"Ejecutar como Administrador"**.
3. El script automáticamente:
   - Habilita el **Escritorio Remoto (RDP)** de Windows y sus reglas en el Firewall.
   - Habilita los puertos de comunicación del servidor local (`8786`, `8787`).
   - Comparte en red la carpeta de MixNet (`M:\comp01` como `\\<IP>\comp01`).
   - Descarga e instala **Tailscale** si no lo tienes instalado.
   - Activa el modo SSH seguro de Tailscale (`tailscale up --ssh`).
4. Si Tailscale te pide iniciar sesión: haz login con tu cuenta de Google o Microsoft.
5. El script mostrará en pantalla:
   ```text
   ============================================================
      DATOS DE CONEXION REMOTA LISTOS PARA TU LAPTOP           
   ============================================================
      IP Privada Tailscale de esta PC : 100.x.y.z
      Nombre del equipo               : Supervisor-Pc
      Usuario de Windows actual       : Supervisor
   ============================================================
   ```
6. **Envía esa dirección IP (`100.x.y.z`) y el nombre de usuario de Windows al administrador en la Laptop.**

### Paso 3: Asegurar que el Servidor Local esté Encendido
En la misma carpeta `wa-server`, haz doble clic en:
* **`START-SERVIDOR.bat`**
*(Esto garantiza que el servicio esté corriendo en segundo plano leyendo MixNet y sincronizando precios).*

---

## 💻 PARTE 2: En tu Laptop (Administrador Remoto)
*(Instrucciones para ti en tu laptop)*

### Paso 1: Instalar Tailscale en tu Laptop
1. Descarga el instalador oficial de Windows (pesa menos de 20 MB):
   👉 [https://tailscale.com/download/windows](https://tailscale.com/download/windows)
2. Instálalo e **inicia sesión con la MISMA cuenta de Google o Microsoft** que se usó en la PC del Supervisor.
3. Al iniciar sesión, verás en la lista de equipos el equipo `Supervisor-Pc` en verde (conectado).

---

### Paso 2: Opciones de Control Remoto desde tu Laptop

Ahora tienes 4 formas de conectarte a la PC del Supervisor según lo que necesites hacer:

#### 1. Ver y controlar la pantalla completa (Escritorio Remoto RDP)
1. En tu laptop, presiona las teclas **`Windows + R`**.
2. Escribe **`mstsc`** y presiona Enter (se abrirá la ventana de Conexión a Escritorio Remoto de Windows).
3. En el campo **Equipo**, coloca la IP de Tailscale de la PC del supervisor (ej: `100.x.y.z`).
4. Ingresa el usuario y contraseña de Windows de la PC del supervisor.
5. **Listo:** Tienes la pantalla de la PC del supervisor en tu laptop con control total de mouse y teclado.

#### 2. Mapear la unidad de MixNet directamente en tu Laptop (Disco M:)
Si quieres que tu laptop tenga la unidad `M:` exactamente como en la tienda:
Abre PowerShell en tu laptop y ejecuta:
```powershell
net use M: \\100.x.y.z\comp01
```
*(Sustituye `100.x.y.z` por la IP de Tailscale del supervisor).*
A partir de ese momento, tu explorador de archivos en la laptop tendrá el disco `M:` conectado a MixNet.

#### 3. Terminal Remota Directa (SSH)
Abre PowerShell o CMD en tu laptop y escribe:
```cmd
ssh usuario@100.x.y.z
```
Entrarás a la terminal de la PC del supervisor al instante, para ejecutar comandos, ver logs o reiniciar procesos.

#### 4. Consultar el estado del Servidor y Forzar Sincronización en Vivo
En tu navegador (Chrome o Edge), abre:
- **Estado de MixNet y Catálogo:** `http://100.x.y.z:8787/lan/mixnet/status`
- **Telemetría y Salud del Servidor:** `http://100.x.y.z:8787/lan/monitor/stats`

---

## 🔒 Seguridad y Privacidad
- Todo el tráfico entre tu Laptop y la PC del Supervisor viaja a través de un túnel cifrado de punto a punto con **WireGuard (clave de 256 bits)**.
- Ningún puerto se abre hacia el internet público; solo las máquinas autenticadas en tu red privada de Tailscale pueden conectarse.
