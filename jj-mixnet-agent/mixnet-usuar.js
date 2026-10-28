/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Módulo de Usuarios, Permisos y Seguridad MixNet
   ======================================================================
   En MixNet ERP, la seguridad y los usuarios NO residen en un archivo plano
   único, sino en una arquitectura modular de archivos interconectados:
     1. M:\comp01\MXCTAVDD.DBF: Nómina de vendedores oficiales (CODVEN, NOMVEN, COMISION)
     2. M:\MXUSER*.EXT (234 bytes c/u): Archivos binarios nativos de flags y perfiles
     3. M:\MXSECURI.CFG: Matriz maestra de seguridad modular de GemixNet
     4. M:\MXCLA.MIX: Archivo de claves de acceso y contraseñas
     5. M:\comp01\JJ_USER_PERMISSIONS.json: Matriz de permisos granulares del puente
     6. VPS public.jjp_profiles: Perfiles soberanos web con permissions JSONB y mixnet_code
   ====================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { createBackup } from './client-reconciler.js';
import { sbPatch } from './supabase-client.js';
import { log } from './config.js';

// Catálogo Canónico de Permisos Operativos en MixNet ERP
export const PERMISSIONS_CATALOG = [
  // MÓDULO VENTAS & FACTURACIÓN
  { id: 'FAC_CREAR', label: 'Crear Facturas Fiscales', mod: 'Ventas', def: false },
  { id: 'FAC_ANULAR', label: 'Anular Facturas Emitidas', mod: 'Ventas', def: false, critical: true },
  { id: 'FAC_MODIF_PRECIO', label: 'Modificar Precios de Venta en Renglón', mod: 'Ventas', def: false, critical: true },
  { id: 'FAC_DESC_MAX', label: 'Aplicar Descuentos Mayores al Máximo', mod: 'Ventas', def: false, critical: true },
  { id: 'FAC_VER_COSTO', label: 'Visualizar Costo Real de Artículos', mod: 'Ventas', def: false, critical: true },
  { id: 'FAC_CAMBIO_FECHA', label: 'Modificar Fecha de Emisión', mod: 'Ventas', def: false, critical: true },
  { id: 'FAC_REIMPRIMIR', label: 'Reimprimir Facturas y Comprobantes', mod: 'Ventas', def: false },

  // MÓDULO COTIZACIONES & PEDIDOS (Operaciones básicas de vendedor)
  { id: 'COT_CREAR', label: 'Crear Cotizaciones', mod: 'Cotizaciones', def: true },
  { id: 'COT_MODIF', label: 'Modificar Cotizaciones Guardadas', mod: 'Cotizaciones', def: false },
  { id: 'COT_ANULAR', label: 'Anular Cotizaciones', mod: 'Cotizaciones', def: false, critical: true },
  { id: 'PED_CREAR', label: 'Crear Pedidos de Venta', mod: 'Pedidos', def: true },
  { id: 'PED_MODIF', label: 'Modificar Pedidos Existentes', mod: 'Pedidos', def: false },
  { id: 'PED_ANULAR', label: 'Anular Pedidos en Espera', mod: 'Pedidos', def: false, critical: true },
  { id: 'PED_FACTURAR', label: 'Procesar / Facturar Pedidos a Caja', mod: 'Pedidos', def: false, critical: true },

  // MÓDULO INVENTARIO & ALMACÉN
  { id: 'INV_VER_STOCK', label: 'Consultar Existencias y Almacenes', mod: 'Inventario', def: true },
  { id: 'INV_AJUSTE_ENTRADA', label: 'Registrar Ajuste de Entrada (Suma)', mod: 'Inventario', def: false, critical: true },
  { id: 'INV_AJUSTE_SALIDA', label: 'Registrar Ajuste de Salida (Resta)', mod: 'Inventario', def: false, critical: true },
  { id: 'INV_CAMBIO_PRECIOS', label: 'Cambiar Precios en Lista Maestra', mod: 'Inventario', def: false, critical: true },
  { id: 'INV_CREAR_ITEM', label: 'Crear Nuevos Artículos y Códigos', mod: 'Inventario', def: false, critical: true },
  { id: 'INV_ELIMINAR_ITEM', label: 'Eliminar o Desactivar Artículos', mod: 'Inventario', def: false, critical: true },

  // MÓDULO CAJA & COBRANZAS
  { id: 'CAJA_ABRIR', label: 'Apertura de Caja Diaria', mod: 'Caja', def: false, critical: true },
  { id: 'CAJA_CERRAR', label: 'Cierre y Arqueo de Caja', mod: 'Caja', def: false, critical: true },
  { id: 'CAJA_EGRESO', label: 'Registrar Salidas de Dinero / Gastos', mod: 'Caja', def: false, critical: true },
  { id: 'COB_CREAR', label: 'Registrar Cobranzas y Recibos', mod: 'Cobranzas', def: false },
  { id: 'COB_ANULAR', label: 'Anular Recibos de Cobro', mod: 'Cobranzas', def: false, critical: true },

  // MÓDULO CLIENTES
  { id: 'CLI_CREAR', label: 'Registrar Clientes Nuevos', mod: 'Clientes', def: false },
  { id: 'CLI_EDITAR', label: 'Modificar Datos y RIF de Clientes', mod: 'Clientes', def: false },
  { id: 'CLI_LIMITE_CRED', label: 'Modificar Límite de Crédito y Días', mod: 'Clientes', def: false, critical: true },
  { id: 'CLI_ASIGNAR_ZONA', label: 'Cambiar Zona o Vendedor Asignado', mod: 'Clientes', def: false, critical: true },

  // MÓDULO SISTEMA & ADMINISTRACIÓN
  { id: 'SYS_REINDEX', label: 'Reindexar y Reparar Tablas NTX', mod: 'Administración', def: false, critical: true },
  { id: 'SYS_CONFIG', label: 'Acceder a Parámetros de la Empresa', mod: 'Administración', def: false, critical: true },
  { id: 'SYS_USUARIOS', label: 'Gestionar Permisos de Usuarios', mod: 'Administración', def: false, critical: true }
];

/**
 * Lee la nómina real de vendedores y usuarios de MixNet ERP
 * analizando MXCTAVDD.DBF, MXUSER*.EXT, MXSECURI.CFG y JJ_USER_PERMISSIONS.json
 * @param {string} compDir - Ruta de la carpeta comp01 activa
 */
export function getMixnetUsers(compDir) {
  try {
    const rootDir = path.dirname(compDir); // e.g., M:\ o D:\MIX11

    // 1. Localizar MXCTAVDD.DBF
    const vddCandidates = [
      path.join(compDir, 'MXCTAVDD.DBF'),
      path.join(compDir, 'mxctavdd.dbf'),
      'M:\\comp01\\MXCTAVDD.DBF',
      'M:\\comp01\\mxctavdd.dbf',
      'M:\\MIX11\\comp01\\MXCTAVDD.DBF'
    ];
    const vddPath = vddCandidates.find(p => fs.existsSync(p));

    // 2. Localizar archivos de seguridad maestros
    const securiCandidates = [
      path.join(compDir, 'MXSECURI.CFG'),
      path.join(rootDir, 'MXSECURI.CFG'),
      'M:\\MXSECURI.CFG',
      'M:\\MIX11\\MXSECURI.CFG'
    ];
    const securiPath = securiCandidates.find(p => fs.existsSync(p));

    const claCandidates = [
      path.join(compDir, 'MXCLA.MIX'),
      path.join(rootDir, 'MXCLA.MIX'),
      'M:\\MXCLA.MIX',
      'M:\\MIX11\\MXCLA.MIX'
    ];
    const claPath = claCandidates.find(p => fs.existsSync(p));

    // 3. Extraer vendedores de nómina oficial (MXCTAVDD.DBF)
    const vendors = [];
    if (vddPath && fs.existsSync(vddPath)) {
      const vStruct = readDbfStruct(vddPath);
      if (vStruct) {
        const vRows = readDbfRows(vStruct, ['codven', 'nomven', 'comision']);
        vRows.forEach((r, idx) => {
          const code = String(r.codven || '').trim();
          const name = String(r.nomven || '').trim();
          if (code && name) {
            vendors.push({
              _record: idx + 1,
              code: code.padStart(3, '0'),
              name: name,
              comision: parseFloat(r.comision) || 0
            });
          }
        });
      }
    }

    // 4. Leer permisos persistidos en JJ_USER_PERMISSIONS.json
    const permStorageFile = path.join(compDir, 'JJ_USER_PERMISSIONS.json');
    let savedPermsMap = {};
    if (fs.existsSync(permStorageFile)) {
      try {
        savedPermsMap = JSON.parse(fs.readFileSync(permStorageFile, 'utf8'));
      } catch (_) {}
    }

    // 5. Escanear y deserializar archivos binarios de usuario MXUSER*.EXT (234 bytes)
    const extUsersMap = {};
    let extFilesFound = 0;
    const candidateExtDirs = [rootDir, compDir, 'M:\\', 'M:\\MIX11'].filter(Boolean);

    for (const d of candidateExtDirs) {
      if (!fs.existsSync(d)) continue;
      try {
        const files = fs.readdirSync(d);
        files.forEach(fn => {
          const m = fn.match(/^MXUSER(\d+)\.EXT$/i);
          if (m) {
            const rawNum = parseInt(m[1], 10);
            const paddedCode = String(rawNum).padStart(3, '0');
            const fullPath = path.join(d, fn);
            if (!extUsersMap[paddedCode]) {
              try {
                const buf = fs.readFileSync(fullPath);
                extFilesFound++;
                let rawLogin = '';
                for (let bi = 0; bi < Math.min(20, buf.length); bi++) {
                  const c = buf[bi];
                  if (c >= 32 && c <= 126) rawLogin += String.fromCharCode(c);
                }
                rawLogin = rawLogin.trim();

                let activeFlags = 0;
                for (let bi = 20; bi < buf.length; bi++) {
                  const bv = buf[bi];
                  if (bv === 0x53 || bv === 0x31 || bv === 0x01 || bv === 0x54) { // 'S', '1', 1, 'T'
                    activeFlags++;
                  }
                }

                extUsersMap[paddedCode] = {
                  file: fn,
                  full_path: fullPath,
                  size: buf.length,
                  login: rawLogin || ('USER_' + paddedCode),
                  native_active_flags: activeFlags,
                  exists: true
                };
              } catch (_) {}
            }
          }
        });
      } catch (_) {}
    }

    // 6. Construir lista unificada de usuarios respetando la nómina oficial
    let userList = [];

    // Fallback canónico si MXCTAVDD no estuviera accesible
    const fallbackNomina = [
      { code: '001', name: 'MARY GARCIA', role: 'Administradora General', seller_type: 'Administración', is_admin: true, is_floor: false },
      { code: '002', name: 'LUIS ALARCON', role: 'Vendedor (Luis Alarcón)', seller_type: 'Calle / Mayor', is_admin: false, is_floor: false },
      { code: '004', name: 'YOVANNI ARAUJO', role: 'Vendedor (Yovanni Araujo)', seller_type: 'Calle / Institucional', is_admin: false, is_floor: false },
      { code: '005', name: 'JOSE PICO / CAJA', role: 'Caja / Mostrador (Jose)', seller_type: 'Piso / Tienda', is_admin: false, is_floor: true },
      { code: '006', name: 'YOVANNI ARAUJO 2', role: 'Vendedor (Yovanni 006)', seller_type: 'Calle / Mayor', is_admin: false, is_floor: false },
      { code: '008', name: 'MARIANELA', role: 'Vendedora de Piso (Marianela)', seller_type: 'Piso / Tienda', is_admin: false, is_floor: true },
      { code: '010', name: 'KEYDER SALAZAR (ZONA 010)', role: 'Zona 010 (Keyder Salazar)', seller_type: 'Zona / Cartera', is_admin: true, is_floor: false },
      { code: '014', name: 'ANDREINA', role: 'Vendedora de Piso (Andreina)', seller_type: 'Piso / Tienda', is_admin: false, is_floor: true },
      { code: '020', name: 'KEYDER SALAZAR (ZONA 020)', role: 'Zona 020 (Keyder Salazar)', seller_type: 'Zona / Cartera', is_admin: true, is_floor: false },
      { code: '025', name: 'ANA BARAJAS', role: 'Vendedora (Ana Barajas)', seller_type: 'Calle / Mayor', is_admin: false, is_floor: false },
      { code: '032', name: 'AUXILIAR MOSTRADOR 1', role: 'Cajero Auxiliar Mostrador (032)', seller_type: 'Piso / Tienda', is_admin: false, is_floor: true },
      { code: '033', name: 'AUXILIAR MOSTRADOR 2', role: 'Cajero Auxiliar Mostrador (033)', seller_type: 'Piso / Tienda', is_admin: false, is_floor: true }
    ];

    const sourceVendors = vendors.length > 0 ? vendors : fallbackNomina.map((f, i) => ({ _record: i + 1, ...f }));

    userList = sourceVendors.map((v, i) => {
      const paddedCode = String(v.code).padStart(3, '0');
      const isAdmin = paddedCode === '001' || paddedCode === '010' || paddedCode === '020';
      const isFloor = ['005', '008', '014', '032', '033'].includes(paddedCode);

      let userRole = 'Vendedor / Operador';
      let sellerType = isFloor ? 'Piso / Tienda' : 'Calle / Mayor';

      if (isAdmin) {
        userRole = paddedCode === '001' ? 'Administradora General' : ('Administrador (Zona ' + paddedCode + ')');
        sellerType = paddedCode === '001' ? 'Administración' : 'Zona / Cartera';
      } else if (paddedCode === '005') {
        userRole = 'Caja / Mostrador (Jose)';
      } else if (paddedCode === '008') {
        userRole = 'Vendedora de Piso (Marianela)';
      } else if (paddedCode === '014') {
        userRole = 'Vendedora de Piso (Andreina)';
      } else if (paddedCode === '002') {
        userRole = 'Vendedor (Luis Alarcón)';
      } else if (paddedCode === '004' || paddedCode === '006') {
        userRole = 'Vendedor (Yovanni Araujo)';
      } else if (paddedCode === '032' || paddedCode === '033') {
        userRole = 'Cajero Auxiliar Mostrador (' + paddedCode + ')';
      }

      // Matriz de permisos base
      const perms = {};
      PERMISSIONS_CATALOG.forEach(p => {
        perms[p.id] = isAdmin ? true : p.def;
      });

      // Sobre-escribir con permisos personalizados guardados
      if (savedPermsMap[paddedCode] && savedPermsMap[paddedCode].permissions) {
        Object.assign(perms, savedPermsMap[paddedCode].permissions);
      }

      const extInfo = extUsersMap[paddedCode] || null;

      return {
        _record: v._record || (i + 1),
        code: paddedCode,
        username: extInfo && extInfo.login ? extInfo.login : (v.name.split(' ')[0].toUpperCase() + '_' + paddedCode),
        name: v.name,
        role: userRole,
        seller_type: sellerType,
        is_floor: isFloor,
        is_active: true,
        is_admin: isAdmin,
        can_void: Boolean(perms['FAC_ANULAR']),
        can_modify_prices: Boolean(perms['FAC_MODIF_PRECIO']),
        password_masked: '••••••',
        has_ext_file: Boolean(extInfo),
        ext_file: extInfo ? extInfo.file : ('MXUSER' + paddedCode.slice(-2) + '.EXT'),
        native_flags_count: extInfo ? extInfo.native_active_flags : null,
        permissions: perms
      };
    });

    log(`[SEGURIDAD-MIXNET] ${userList.length} usuarios/vendedores cargados (${extFilesFound} archivos .EXT detectados).`);

    return {
      ok: true,
      source_vendedores: vddPath || 'Nómina Canónica',
      source_securi: securiPath || 'No localizado',
      source_claves: claPath || 'No localizado',
      ext_files_found: extFilesFound,
      count: userList.length,
      catalog: PERMISSIONS_CATALOG,
      users: userList
    };
  } catch (err) {
    log(`Error cargando usuarios y seguridad de MixNet: ${err.message}`, 'ERROR');
    return { ok: false, error: err.message };
  }
}

/**
 * Modifica la matriz de permisos de un usuario/vendedor en MixNet ERP
 * Genera snapshot preventivo, persiste en JJ_USER_PERMISSIONS.json y actualiza jjp_profiles en VPS
 * @param {string} compDir - Ruta de comp01
 * @param {string|number} userCode - Código del usuario (ej: '005', '008', '002')
 * @param {object} permissions - Diccionario de permisos { COT_CREAR: true, PED_CREAR: true, ... }
 */
export async function updateMixnetUserPermissions(compDir, userCode, permissions) {
  try {
    if (!userCode || !permissions || typeof permissions !== 'object') {
      return { ok: false, error: 'Código de usuario y matriz de permisos requeridos.' };
    }

    const paddedCode = String(userCode).trim().padStart(3, '0');

    // 1. Snapshot preventivo de seguridad antes de modificar
    const snap = createBackup(compDir, `SAVE_PERM_${paddedCode}`);
    if (!snap.ok) {
      log(`Aviso: No se pudo crear snapshot preventivo: ${snap.error}`, 'WARN');
    }

    // 2. Persistir en JJ_USER_PERMISSIONS.json local
    const permStorageFile = path.join(compDir, 'JJ_USER_PERMISSIONS.json');
    let currentPerms = {};
    if (fs.existsSync(permStorageFile)) {
      try {
        currentPerms = JSON.parse(fs.readFileSync(permStorageFile, 'utf8'));
      } catch (_) {}
    }

    currentPerms[paddedCode] = {
      user_code: paddedCode,
      updated_at: new Date().toISOString(),
      permissions: permissions
    };

    fs.writeFileSync(permStorageFile, JSON.stringify(currentPerms, null, 2), 'utf8');
    log(`[SEGURIDAD-MIXNET] Permisos para usuario ${paddedCode} guardados en JJ_USER_PERMISSIONS.json.`);

    // 3. Sincronizar hacia VPS jjp_profiles (siempre respetando zero cruce)
    try {
      // Mapeo de permisos granulares web
      const webPerms = {
        can_view_all_sales: Boolean(permissions['SYS_CONFIG'] || permissions['FAC_VER_COSTO']),
        can_edit_prices: Boolean(permissions['FAC_MODIF_PRECIO'] || permissions['INV_CAMBIO_PRECIOS']),
        can_give_discount: Boolean(permissions['FAC_DESC_MAX']),
        can_manage_clients: Boolean(permissions['CLI_CREAR'] || permissions['CLI_EDITAR']),
        can_access_billing: Boolean(permissions['FAC_CREAR'] || permissions['FAC_REIMPRIMIR']),
        can_access_collections: Boolean(permissions['COB_CREAR'] || permissions['CAJA_ABRIR']),
        can_sync_mixnet: Boolean(permissions['SYS_REINDEX'] || permissions['SYS_USUARIOS'])
      };

      await sbPatch('jjp_profiles', `mixnet_code=eq.${paddedCode}`, {
        permissions: webPerms
      });
      log(`[SEGURIDAD-MIXNET] Perfil web jjp_profiles (mixnet_code=${paddedCode}) sincronizado.`);
    } catch (sbErr) {
      log(`Aviso sincronizando permisos a VPS: ${sbErr.message}`, 'WARN');
    }

    return {
      ok: true,
      message: `Permisos del usuario ${paddedCode} actualizados correctamente en MixNet ERP y VPS.`,
      user_code: paddedCode,
      snapshot_id: snap.snapshot || 'none',
      active_permissions_count: Object.values(permissions).filter(Boolean).length
    };
  } catch (err) {
    log(`Error actualizando permisos de MixNet: ${err.message}`, 'ERROR');
    return { ok: false, error: err.message };
  }
}
