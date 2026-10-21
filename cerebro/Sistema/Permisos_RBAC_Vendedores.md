# Modelo de Permisos RBAC y Mapeo Canónico de Vendedores

> **Documento del Cerebro de JJ Paper**  
> **Fecha de Actualización:** 21 de Octubre de 2026  
> **Vistas Asociadas:** `admin/vendedores.html`, `assets/js/admin/sellers.js`  
> **Tabla de Base de Datos:** `public.jjp_profiles` en `jjpaper_db` (VPS)

---

## 1. Roles Canónicos del Negocio

Para reflejar la estructura organizativa real de la empresa y los permisos operativos de MixNet, la base de datos fue actualizada con el constraint expandido `jjp_profiles_role_check`:

| Rol de Usuario | Valor en BD | Alcance y Funciones |
| :--- | :--- | :--- |
| **🛡️ Administrador** | `admin` | Control total del sistema, VPS, monitor de cuotas, rollbacks, gestión de usuarios (máx. 4). |
| **🕵️ Supervisor** | `supervisor` | Auditoría de ventas, asignación de zonas, conciliación de clientes y revisión de métricas. |
| **🧑‍💼 Vendedor** | `vendedor` | Catálogo digital, POS de ventas, emisión de cotizaciones y atención de clientes asignados. |
| **🧾 Facturación** | `facturacion` | Emisión de facturas, cuadre de caja diario, despacho fiscal y sincronización con MixNet. |
| **💳 Cobranza** | `cobranza` | Gestión de cuentas por cobrar, seguimiento de créditos, recibos de pago y auditoría RIF. |
| **🪙 Cajero** | `cajero` | Cobro en mostrador, recepción de transferencias/efectivo y emisión de comprobantes. |

---

## 2. Matriz de Permisos Granulares (`permissions JSONB`)

Cada perfil en `jjp_profiles` cuenta con una columna `permissions JSONB` que permite habilitar o revocar privilegios específicos sin importar el rol base:

```json
{
  "can_view_all_sales": true,
  "can_edit_prices": false,
  "can_give_discount": true,
  "can_manage_clients": true,
  "can_access_billing": false,
  "can_access_collections": true,
  "can_sync_mixnet": false
}
```

### Descripción de Privilegios:
1. `can_view_all_sales`: Permite al usuario ver las ventas globales de toda la empresa y no solo las de su código asignado.
2. `can_edit_prices`: Permite alterar el precio unitario sugerido en el catálogo durante una venta POS.
3. `can_give_discount`: Autoriza a otorgar descuentos superiores al 10% en cotizaciones y pedidos.
4. `can_manage_clients`: Otorga permisos para editar nombres, RIF, direcciones y zonas de clientes.
5. `can_access_billing`: Permite ingresar al módulo de cuentas por cobrar, facturas y caja.
6. `can_access_collections`: Habilita la conciliación bancaria y validación de comprobantes.
7. `can_sync_mixnet`: Habilita la ejecución forzada de sincronizaciones y compilación de índices `.NTX`.

---

## 3. Mapeo Canónico con Códigos de Vendedor MixNet (`CODVEN`)

En MixNet ERP, cada vendedor tiene un código de 3 caracteres asignado en `MXCLIEN.DBF`, `MXENCCOT.DBF` y `MXENCPED.DBF`. En el VPS, la columna `mixnet_code` en `jjp_profiles` mapea directamente estos valores:

| Código MixNet | Vendedor Oficial | UUID Perfil Web (`jjp_profiles.id`) | Zona / Rol |
| :---: | :--- | :--- | :--- |
| **`001`** | Mary García | `86b0ef8b-a41b-4385-a8f9-314a5052cb94` | Zona 001 |
| **`002`** | Luis Alarcón | `e6957754-de00-4088-8e54-affcaa172247` | Zona 002 |
| **`004`** | Yovanni Araujo | `07540d9c-4ed9-46d2-95ce-0a0200be6083` | Zona 004 / 006 / 009 |
| **`008`** | Marianela Ventas JJ | `3c9b7ddd-4b98-45c6-a646-5c557a2bc043` | Zona 008 |
| **`010`** | Keyder Salazar (Admin) | `bddc57dc-5bf9-4a72-9e1c-751d07b03164` | Zona 010 (Admin) |
| **`014`** | Andreina JJ Ventas | `68c29cd3-760a-4282-8214-4e7c60413ec5` | Zona 014 |
| **`020`** | Keyder Salazar (Cartera) | `bddc57dc-5bf9-4a72-9e1c-751d07b03164` | Zona 020 (Cartera) |
| **`025`** | Ana Barajas | `7eeb41f2-55e1-4e5e-b6c2-3da87582b51b` | Zona 025 |
| **`026`** | JJ Paper 26 | `4d76dc4c-503a-48ca-9c98-f9ea3d2af755` | Zona 026 |
| **`032`** | JJ Paper 32 | `9201071b-ab77-4de3-90a4-a79c93c4213c` | Zona 032 |
| **`033`** | JJ Paper 33 | `485e3fde-f95d-4857-9175-147051a54748` | Zona 033 |

---

## 4. Guarda de Seguridad Anti-Lockout

El panel `admin/vendedores.html` incluye salvaguardas estrictas en `assets/js/admin/sellers.js`:
* Si queda un solo Administrador activo en el sistema, la interfaz **bloquea la degradación de rol y la desactivación del usuario**.
* Impide eliminar el acceso administrativo para proteger la continuidad de las operaciones de JJ Paper.
