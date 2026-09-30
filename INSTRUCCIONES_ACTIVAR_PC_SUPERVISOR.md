# Protocolo de Activación en PC Supervisor (Servidor JJ Paper)

> **AVISO IMPORTANTE:** Este archivo contiene las instrucciones exactas y ordenadas para el agente u operador que se encuentre en la **PC Supervisor** de la tienda/oficina.
> En la **Laptop**, el servidor ha sido **DETENIDO** por completo. El servicio debe correr **ÚNICAMENTE** en la PC Supervisor, que tiene acceso directo a la unidad de MixNet (`M:/comp01`).

---

## 1. Paso a Paso en la PC Supervisor

### Paso 1: Actualizar el Repositorio
Abre una terminal (CMD o PowerShell) en la carpeta del proyecto y descarga todos los cambios ya subidos a Git:
```cmd
cd "C:\Users\PC\Desktop\JJ PAPER"
git pull origin main
```

### Paso 2: Detener Cualquier Instancia Previa
Si hay una versión vieja del servidor corriendo en la PC Supervisor, libérala:
* Hacer doble clic en `wa-server\DETENER-SERVIDOR.bat`
*(O en consola: `taskkill /F /FI "WINDOWTITLE eq JJ Paper*"` o liberar puerto 8786).*

### Paso 3: Encender el Servidor en Segundo Plano
Para iniciarlo como **proceso independiente** (sin ventana negra y sin depender de terminales ni de Antigravity):
* Hacer doble clic en:
  **`wa-server\START-SERVIDOR.bat`**
  *(Internamente ejecuta `wscript start-hidden.vbs`, el cual inicia `run-service.bat` en modo oculto).*

### Paso 4: (Recomendado) Instalar en Arranque Automático de Windows
Para que el servidor se levante automáticamente cada vez que se encienda la PC Supervisor:
* Hacer doble clic en:
  **`wa-server\INSTALAR-EN-ARRANQUE-WINDOWS.bat`**

### Paso 5: Configurar Enlace Remoto para el Administrador (Laptop)
Para permitir que el administrador se conecte desde su Laptop (por Escritorio Remoto, terminal y lectura de MixNet sin importar dónde se encuentre):
* Clic derecho en **`wa-server\CONFIGURAR-ACCESO-REMOTO-SUPERVISOR.bat`** y elegir **"Ejecutar como Administrador"**.
* El script configurará Tailscale, activará RDP, compartirá la carpeta de MixNet y mostrará la IP privada (`100.x.y.z`).
* **Envía esa IP privada al administrador en la Laptop.** (Ver guía completa en `docs/GUIA_ACCESO_REMOTO_SUPERVISOR.md`).

---

## 2. Verificación de Funcionamiento

### A. Desde la Consola
Hacer doble clic en:
**`wa-server\ESTADO-SERVIDOR.bat`**

### B. Desde el Navegador Local de la PC
Abre en Chrome o Edge:
* **Estado de MixNet y Catálogo:** [http://localhost:8787/lan/mixnet/status](http://localhost:8787/lan/mixnet/status)
* **Telemetría y Salud de los 3 Proyectos:** [http://localhost:8787/lan/monitor/stats](http://localhost:8787/lan/monitor/stats)
* **Logs en tiempo real:** Ver archivo `wa-server\logs\wa-server.log`

---

## 3. Topología de Proyectos Activa (Ya Sincronizada)

| Proyecto | Ref | URL | Función |
|---|---|---|---|
| **A (Core Nuevo)** | `wwcdxqpibequfohbgejs` | `https://wwcdxqpibequfohbgejs.supabase.co` | Clientes, Productos, Pedidos, Cotizaciones, Tasas |
| **B (Comunicación)** | `klcibjwleiqppedefpxw` | `https://klcibjwleiqppedefpxw.supabase.co` | WhatsApp (Baileys), Campañas, Correos CRM, Heartbeat |
| **C (Storage)** | `nmcamjxhyysmmvgxgabo` | `https://nmcamjxhyysmmvgxgabo.supabase.co` | Imágenes de productos WebP, Comprobantes |

---

## 4. Recordatorio sobre el Error `exceed_egress_quota`
Si algún usuario entra al panel web (`jjpaper.lat`) y ve ese mensaje, se debe a la **caché de su navegador** recordando el proyecto viejo. La solución es presionar **`Ctrl + F5`** (o `Ctrl + Shift + R`) una sola vez para refrescar el nuevo `config.js?v=20260930_core`.
