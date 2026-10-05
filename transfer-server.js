// JJ PAPER -- Servidor de Descarga Directa por Red Local (LAN)
// Permite que la PC con Windows 7 descargue el paquete directamente desde la laptop sin USB
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const PUENTE_ZIP = path.join(__dirname, 'puente-mixnet-win7.zip');
const FULL_ZIP   = path.join(__dirname, 'antigravity-win7.zip');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // Descarga del Puente Autónomo Ultra-Ligero (13 KB) - Recomendado
  if (url === '/puente-mixnet-win7.zip' || url === '/puente' || url === '/descargar-puente' || url === '/descargar') {
    const targetFile = fs.existsSync(PUENTE_ZIP) ? PUENTE_ZIP : FULL_ZIP;
    if (!fs.existsSync(targetFile)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Archivo de instalacion no encontrado.');
    }
    const stat = fs.statSync(targetFile);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="' + path.basename(targetFile) + '"',
      'Content-Length': stat.size
    });
    fs.createReadStream(targetFile).pipe(res);
    console.log('[LAN DOWNLOAD] La PC descargo ' + path.basename(targetFile) + ' con exito.');
    return;
  }

  // Descarga del paquete con Cockpit
  if (url === '/antigravity-win7.zip') {
    if (!fs.existsSync(FULL_ZIP)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Archivo antigravity-win7.zip no encontrado.');
    }
    const stat = fs.statSync(FULL_ZIP);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="antigravity-win7.zip"',
      'Content-Length': stat.size
    });
    fs.createReadStream(FULL_ZIP).pipe(res);
    console.log('[LAN DOWNLOAD] La PC descargo antigravity-win7.zip con exito.');
    return;
  }

  if (url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('PONG');
  }

  // Página web visual para descargar con 1 clic desde el navegador de Windows 7
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>JJ Paper — Descarga Directa Puente Win7</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #070a13; color: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #0c1220; border: 1px solid #1b253b; border-radius: 12px; padding: 32px; max-width: 560px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
    h1 { font-size: 22px; color: #00d2ff; margin-bottom: 8px; }
    p { color: #8292ab; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .btn { display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: #fff; font-weight: 700; font-size: 16px; padding: 14px 28px; border-radius: 8px; text-decoration: none; box-shadow: 0 4px 15px rgba(16,185,129,0.4); transition: transform 0.1s; margin-bottom: 12px; }
    .btn:hover { transform: scale(1.02); }
    .steps { text-align: left; background: rgba(255,255,255,0.03); border: 1px solid #1b253b; border-radius: 8px; padding: 16px; margin-top: 24px; font-size: 13px; color: #cbd5e1; }
    .steps ol { padding-left: 20px; margin: 0; }
    .steps li { margin-bottom: 8px; }
    .badge { display: inline-block; background: rgba(0, 210, 255, 0.1); color: #00d2ff; border: 1px solid rgba(0, 210, 255, 0.3); font-size: 11px; padding: 3px 8px; border-radius: 4px; margin-bottom: 12px; }
    .highlight { color: #10b981; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">CONEXIÓN DIRECTA LAPTOP ➔ TIENDA</div>
    <h1>JJ PAPER — PUENTE AUTÓNOMO WIN-7</h1>
    <p>Sincronizador ultra-ligero (<span class="highlight">13 KB</span>, 20 MB RAM). Escribe y lee directamente en los DBF de MixNet (<b>MXENCPED</b>, <b>MXENCCOT</b>) y sincroniza cotizaciones, pedidos y correlativos bidireccionalmente con la nube de JJ Paper.</p>
    
    <a href="/puente-mixnet-win7.zip" class="btn">⬇️ Descargar Puente Autónomo (13 KB - Recomendado)</a>

    <div class="steps">
      <strong style="color:#fff;">Instalación en 2 simples pasos:</strong>
      <ol style="margin-top:8px;">
        <li>Descarga el archivo ZIP y extráelo en tu <b>Escritorio</b>.</li>
        <li>Haz doble clic en: <b>INICIAR-PUENTE.bat</b></li>
        <li>(Opcional) Si quieres que inicie solo al prender la PC, haz doble clic en <b>INSTALAR-AUTO-ARRANQUE.bat</b>.</li>
      </ol>
    </div>
  </div>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================================================');
  console.log('  JJ PAPER -- SERVIDOR DE TRANSFERENCIA DIRECTA POR RED (LAN)          ');
  console.log('========================================================================');
  console.log('  [OK] Servidor de descarga listo en puerto: ' + PORT);
  console.log('  [OK] Abre este enlace desde la PC Windows 7:');
  console.log('       http://192.168.1.11:' + PORT);
  console.log('========================================================================\n');
});
