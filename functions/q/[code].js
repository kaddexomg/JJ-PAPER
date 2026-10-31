// Cloudflare Pages Function: GET /q/:code?v=:sellerCode
// Redirección 302 ultracorta para códigos QR de catálogo impreso y venta de calle.
// Reduce la URL de ~110 caracteres a ~38-42 caracteres, bajando la densidad
// del código QR a ~29x29 módulos y duplicando el tamaño físico de cada celda para escaneo veloz.

export async function onRequest(context) {
  const { request, params } = context;
  const rawCode = params.code ? decodeURIComponent(params.code).trim() : '';
  const url = new URL(request.url);
  const seller = (url.searchParams.get('v') || url.searchParams.get('ref') || url.searchParams.get('seller') || '').trim();

  // Si no se proporcionó código, redirigir al catálogo general
  if (!rawCode) {
    const fallbackPath = seller ? `/catalogo.html?ref=${encodeURIComponent(seller)}` : '/catalogo.html';
    return Response.redirect(new URL(fallbackPath, url.origin).toString(), 302);
  }

  // Detectar si el código es un UUID completo (36 chars) o un prefijo hex de 8 caracteres derivado del ID
  const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCode);
  const isHex8 = /^[0-9a-f]{8}$/i.test(rawCode);

  const refQuery = seller ? `&ref=${encodeURIComponent(seller)}` : '';
  let targetPath;

  if (isFullUuid || isHex8) {
    targetPath = `/producto.html?id=${encodeURIComponent(rawCode)}${refQuery}`;
  } else {
    // Es un SKU comercial de JJ Paper (ej: CP-BN3, GR-TOARO, KO-FOAB)
    targetPath = `/producto.html?sku=${encodeURIComponent(rawCode)}${refQuery}`;
  }

  const destination = new URL(targetPath, url.origin).toString();

  return new Response(null, {
    status: 302,
    headers: {
      'Location': destination,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
