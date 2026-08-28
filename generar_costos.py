import os, json, csv
from rapidfuzz import fuzz

jj_products = []
with open(r'C:\Users\PC\Desktop\JJ PAPER\sql\jjpaper_productos_import.csv', 'r', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        jj_products.append(row)

with open(r'C:\Users\PC\Desktop\proveedoresapp\COSTOS\costos_iniciales.json', 'r', encoding='utf-8') as f:
    costos_data = json.load(f)

providers = {p['id']: p['name'] for p in costos_data.get('providers', [])}
provider_products = costos_data.get('products', [])

mayka_items = [
    {'name': 'ARCHIVADOR OFICIO LOMO ANCHO IMP', 'price': 2.16, 'prov': 'Industrias Mayka'},
    {'name': 'ARCHIVADOR CARTA LOMO ANCHO IMP', 'price': 2.08, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA EXPRESS OFICIO IMP', 'price': 0.30, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA EXPRESS CARTA IMP', 'price': 0.28, 'prov': 'Industrias Mayka'},
    {'name': 'ARCHIVADOR OFICIO LOMO ANCHO', 'price': 3.67, 'prov': 'Industrias Mayka'},
    {'name': 'ARCHIVADOR CARTA LOMO ANCHO', 'price': 3.67, 'prov': 'Industrias Mayka'},
    {'name': 'ARCHIVADOR SINFONIA OFIC ALFANUM', 'price': 12.41, 'prov': 'Industrias Mayka'},
    {'name': 'ARCHIVADOR SINFONIA CARTA ALFANUM', 'price': 10.48, 'prov': 'Industrias Mayka'},
    {'name': 'ARCHIVADOR SINFONIA GIRO ALFANUM', 'price': 6.83, 'prov': 'Industrias Mayka'},
    {'name': 'BANDAS DE GOMA 250 GRS N 18', 'price': 8.30, 'prov': 'Industrias Mayka'},
    {'name': 'BANDAS DE GOMA 50 GRS N 18', 'price': 1.61, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETAS COLGANTES EXPRESS', 'price': 0.90, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA PLAST S OFICIO', 'price': 1.02, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA PLAST S CARTA', 'price': 1.02, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA POPULAR OFICIO', 'price': 0.65, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA POPULAR CARTA', 'price': 0.65, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA EXPRESS OFICIO', 'price': 0.59, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA FIBRA EXPRESS CARTA', 'price': 0.59, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETAS FIBRA STANDARD OFICIO', 'price': 0.30, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETAS FIBRA STANDARD CARTA', 'price': 0.30, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA 3 AROS 1 1/2 CRISTAL BLANCA', 'price': 4.87, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA 3 AROS 2 CRISTAL BLANCA', 'price': 5.72, 'prov': 'Industrias Mayka'},
    {'name': 'CAJAS DE GANCHOS PRESTO', 'price': 4.55, 'prov': 'Industrias Mayka'},
    {'name': 'TABLAS DE CARTON PIEDRA OFICIO', 'price': 2.65, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA PRESION SUPER OFICIO SURT', 'price': 0.71, 'prov': 'Industrias Mayka'},
    {'name': 'CARPETA PRESION SUPER CARTA SURT', 'price': 0.71, 'prov': 'Industrias Mayka'},
    {'name': 'BORRADORES NATA 612 E', 'price': 7.02, 'prov': 'Industrias Mayka'},
    {'name': 'BORRADORES NATA 620 E', 'price': 11.89, 'prov': 'Industrias Mayka'},
    {'name': 'BORRADORES NATA 624 E', 'price': 5.80, 'prov': 'Industrias Mayka'},
    {'name': 'ALMOHADILLA MAYKA NO 0', 'price': 1.08, 'prov': 'Industrias Mayka'},
    {'name': 'ALMOHADILLA MAYKA NO 1', 'price': 1.26, 'prov': 'Industrias Mayka'},
    {'name': 'REGLAS GRADUADAS DE 30 CMS', 'price': 0.48, 'prov': 'Industrias Mayka'},
    {'name': 'PAPEL CREPE 2MTS', 'price': 0.43, 'prov': 'Industrias Mayka'},
    {'name': 'BOLIGRAFO MILAN SWAY MIX AZUL', 'price': 0.64, 'prov': 'Milan'},
    {'name': 'BOLIGRAFO MILAN AZUL P1 TOUCH', 'price': 0.39, 'prov': 'Milan'},
    {'name': 'BOLIGRAFO MILAN NEGRO P1 TOUCH', 'price': 0.39, 'prov': 'Milan'},
    {'name': 'SACAPUNTAS MILAN ALUMINIO RECTAN', 'price': 0.26, 'prov': 'Milan'},
    {'name': 'BORRADOR MILAN 430 MIGA DE PAN', 'price': 5.22, 'prov': 'Milan'},
    {'name': 'LAPIZ MILAN DE GRAFITO SUNSET', 'price': 10.26, 'prov': 'Milan'},
    {'name': 'LAPIZ DE GRAFITO MILAN HEXAGONAL HB', 'price': 2.48, 'prov': 'Milan'},
    {'name': 'LAPIZ DE COLOR TRIANGULARES MILAN 12', 'price': 2.30, 'prov': 'Milan'},
    {'name': 'MARCADOR PIZARRA PUNTA REDONDA NEGRO MILAN', 'price': 0.54, 'prov': 'Milan'},
    {'name': 'MARCADOR PERMANENTE PUNTA REDONDA NEGRO MILAN', 'price': 0.48, 'prov': 'Milan'},
    {'name': 'RESALTADOR MILAN FLUOR AMARILLO', 'price': 0.50, 'prov': 'Milan'},
    {'name': 'REGLA PLASTICA FLEXIBLE MILAN 30CM AZUL', 'price': 1.03, 'prov': 'Milan'},
    {'name': 'PEGA EN BARRA 8G MILAN', 'price': 0.32, 'prov': 'Milan'},
    {'name': 'PEGA EN BARRA 21G MILAN', 'price': 0.53, 'prov': 'Milan'},
    {'name': 'PEGA EN BARRA 40G MILAN', 'price': 0.81, 'prov': 'Milan'},
    {'name': 'CINTA CORRECTORA MILAN 5MM X 6M', 'price': 1.09, 'prov': 'Milan'},
    {'name': 'CLIPS METAL NIQUELADOS 33MM MILAN', 'price': 0.76, 'prov': 'Milan'},
    {'name': 'GRAPAS LISAS MILAN 24/6', 'price': 0.51, 'prov': 'Milan'},
    {'name': 'CINTA ADHESIVA CRISTAL MILAN 19MMX33M', 'price': 0.62, 'prov': 'Milan'},
    {'name': 'CINTA ADHESIVA MILAN 12MMX66M', 'price': 0.62, 'prov': 'Milan'},
    {'name': 'CINTA EMBALAJE INDUSTRIAL MARRON MILAN 50MMX66M', 'price': 2.63, 'prov': 'Milan'},
    {'name': 'COMPAS ESCOLAR MILAN DOBLE PATA ARTICULADA', 'price': 3.21, 'prov': 'Milan'}
]

for m in mayka_items:
    provider_products.append({
        'name': m['name'],
        'price': m['price'],
        'provider_name': m['prov']
    })

actualizados = 0
updates_sql = []
productos_finales = []

for p in jj_products:
    p_name = p.get('name', '').strip()
    p_sku = p.get('sku', '').strip()
    p_price = float(p.get('price_usd') or 0)
    
    best_score = 0
    best_offer = None
    
    for pp in provider_products:
        score = fuzz.token_sort_ratio(p_name.lower(), pp['name'].lower())
        if score > best_score:
            best_score = score
            best_offer = pp
            
    cost_val = ''
    if best_score >= 65 and best_offer:
        raw_cost = float(best_offer.get('price') or 0)
        if p_price > 0 and raw_cost > p_price * 1.5:
            if raw_cost / 12.0 <= p_price:
                cost_val = round(raw_cost / 12.0, 2)
            elif raw_cost / 10.0 <= p_price:
                cost_val = round(raw_cost / 10.0, 2)
            elif raw_cost / 24.0 <= p_price:
                cost_val = round(raw_cost / 24.0, 2)
            else:
                cost_val = round(raw_cost, 2)
        else:
            cost_val = round(raw_cost, 2)
            
        p['cost_usd'] = str(cost_val)
        actualizados += 1
        prov = best_offer.get('provider_name') or providers.get(best_offer.get('provider_id'), 'Proveedor')
        comment_str = f'-- {p_name} | Costo de {prov} (match {best_score}%)'
        safe_sku = p_sku.replace(\"'\", \"''\")
        updates_sql.append(f\"UPDATE jjp_products SET cost_usd = {cost_val} WHERE sku = '{safe_sku}'; {comment_str}\")
    else:
        p['cost_usd'] = ''
        
    productos_finales.append(p)

with open(r'C:\Users\PC\Desktop\JJ PAPER\sql\jjpaper_productos_con_costos.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(productos_finales[0].keys()))
    writer.writeheader()
    writer.writerows(productos_finales)

with open(r'C:\Users\PC\Desktop\JJ PAPER\sql\ACTUALIZAR_COSTOS_PROVEEDORES.sql', 'w', encoding='utf-8') as f:
    f.write('-- ======================================================\n')
    f.write('-- ACTUALIZACION DE COSTOS DE COMPRA (PROVEEDORES)\n')
    f.write('-- No altera precios de venta (price_usd)\n')
    f.write('-- ======================================================\n\n')
    f.write('\n'.join(updates_sql))

print(f'Proceso completado exitosamente: {actualizados} productos actualizados.')
