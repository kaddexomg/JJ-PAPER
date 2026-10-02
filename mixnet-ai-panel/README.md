# 🚀 JJ Paper &middot; Suite Salaz — Control Total MixNet ERP con Copiloto Gemini AI

> Sistema ejecutivo ultra-ligero y autónomo diseñado para funcionar con alta estabilidad en **Windows 7 / 10 / 11** y **Node.js 13+** (cero dependencias externas npm, bajo consumo de memoria RAM < 45 MB).

---

## 📊 Módulos y Capacidades Incluidas

1. **💰 Cuentas por Cobrar (CxC):**
   - Análisis de toda la cartera de clientes, RIF, límites de crédito y saldo pendiente.
   - Detección de pedidos pendientes de cobro y clasificación por vendedor.
2. **💳 Cuentas por Pagar (CxP):**
   - Proveedores registrados, facturas de compras y vencimientos pendientes de pago.
3. **👥 Nómina y Comisiones por Vendedor:**
   - Asignación estricta de ventas por código oficial de nómina:
     - `002`: Luis Alarcón
     - `004` / `006`: Yovanni Araujo
     - `008`: Marianela
     - `014`: Andreina
     - `010` / `020`: Keyder Salazar
     - `005`: Caja Principal / Mostrador Físico
   - Cálculo automático de comisiones y volumen facturado.
4. **📦 Inventario y Stock Físico:**
   - Catálogo de artículos con existencias.
   - Valoración total a costo de reposición vs. precio de venta B.
   - Cálculo de margen potencial y alertas de stock en cero.
5. **🏦 Bancos y Caja:**
   - Saldos consolidados en cuentas bancarias y movimientos diarios de caja.
6. **🤖 Copiloto Inteligente Gemini IA:**
   - Pool de 7 claves de API de Google Gemini con rotación automática y failover.
   - Consultas en lenguaje natural con acceso a los datos reales de MixNet.
   - Botones de auditoría con 1 clic: Financiera, Cobranzas, Nómina y Stock.
7. **🔌 Enlace de Red con PC Supervisor:**
   - Enlace automático con el servidor central en `192.168.0.172:8787`.
   - Reintento silencioso sin congelamiento de interfaz ante caídas de red.

---

## ⚡ Cómo Usar en la PC

1. **Clonar o descargar el repositorio:**
   ```bash
   git clone https://github.com/kaddexomg/salaz.git
   ```
2. **Iniciar:**
   - Haz doble clic en el archivo:
     **`INICIAR.bat`**
3. El sistema abrirá automáticamente tu navegador en:
   **`http://localhost:3300`**
   *(o desde cualquier otra PC en la misma red: `http://IP_DE_ESTA_PC:3300`)*.
