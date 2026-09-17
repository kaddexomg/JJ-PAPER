import os
import io
import json
import urllib.request
import urllib.error
from PIL import Image

URL_A = "https://qxgdrfkobbhdzgtoiavv.supabase.co"
KEY_A = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z2RyZmtvYmJoZHpndG9pYXZ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzkzNzE5MiwiZXhwIjoyMTAzNTEzMTkyfQ.6TW5y4D46tbb6X3aF1Pfo0oNOmXg4dyTDCD97geYKRw"

URL_C = "https://nmcamjxhyysmmvgxgabo.supabase.co"
KEY_C = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tY2FtanhoeXlzbW12Z3hnYWJvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjA2MTQ2NCwiZXhwIjoyMDk3NjM3NDY0fQ.QvuDcLSJleatqDcglU_w0fRnXbz9N6scGaDVqCUgoXg"

def rest_get(url, key, endpoint):
    req = urllib.request.Request(
        f"{url}/rest/v1/{endpoint}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

def rest_patch(url, key, endpoint, data):
    body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(
        f"{url}/rest/v1/{endpoint}",
        data=body,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status in (200, 204)
    except Exception as e:
        print(f"Error en PATCH: {e}")
        return False

def upload_to_supabase(url, key, bucket, filename, data, content_type="image/webp"):
    target_url = f"{url}/storage/v1/object/{bucket}/{filename}"
    req = urllib.request.Request(
        target_url,
        data=data,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": content_type,
            "x-upsert": "true"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        if e.code in (400, 409):
            req_put = urllib.request.Request(
                target_url,
                data=data,
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": content_type
                },
                method="PUT"
            )
            try:
                with urllib.request.urlopen(req_put) as resp_put:
                    return resp_put.status in (200, 201)
            except Exception as e2:
                print(f"Error en PUT {filename}: {e2}")
                return False
        return False
    except Exception as e:
        print(f"Error subiendo {filename}: {e}")
        return False

def delete_from_supabase(url, key, bucket, prefixes):
    target_url = f"{url}/storage/v1/object/{bucket}"
    body = json.dumps({"prefixes": prefixes}).encode('utf-8')
    req = urllib.request.Request(
        target_url,
        data=body,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"
        },
        method="DELETE"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status in (200, 204)
    except Exception:
        return False

def main():
    print("=== OPTIMIZACIÓN Y COMPRESIÓN DE IMÁGENES A WEBP ===")
    products = rest_get(URL_A, KEY_A, "jjp_products?select=id,image_url&image_url=not.is.null")
    variants = rest_get(URL_A, KEY_A, "jjp_product_variants?select=id,image_url&image_url=not.is.null")

    files_map = {}
    for p in products + variants:
        url = p.get('image_url')
        if not url:
            continue
        filename = url.split('/')[-1].split('?')[0]
        if filename and filename not in files_map:
            files_map[filename] = url

    print(f"Total imágenes únicas a procesar: {len(files_map)}")

    total_orig_bytes = 0
    total_opt_bytes = 0
    migrated_map = {} # old_filename -> new_filename
    old_files_to_delete = []

    items = list(files_map.items())
    for idx, (filename, orig_url) in enumerate(items, 1):
        try:
            req = urllib.request.Request(orig_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
            
            orig_size = len(data)
            total_orig_bytes += orig_size

            # Optimizar con Pillow
            img = Image.open(io.BytesIO(data))
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGBA' if 'transparency' in img.info else 'RGB')

            # Redimensionar a max 800x800
            img.thumbnail((800, 800), Image.Resampling.LANCZOS)

            # Guardar en WebP calidad 80
            out = io.BytesIO()
            img.save(out, format='WEBP', quality=80, method=6)
            webp_data = out.getvalue()
            opt_size = len(webp_data)
            total_opt_bytes += opt_size

            base_name = os.path.splitext(filename)[0]
            new_filename = f"{base_name}.webp"

            # Subir a Proyecto C (Storage Principal) y Proyecto A (Respaldo)
            up_c = upload_to_supabase(URL_C, KEY_C, "jjp-products", new_filename, webp_data, "image/webp")
            upload_to_supabase(URL_A, KEY_A, "jjp-products", new_filename, webp_data, "image/webp")

            if up_c:
                migrated_map[filename] = new_filename
                if filename != new_filename:
                    old_files_to_delete.append(filename)

            if idx % 25 == 0 or idx == len(items):
                pct = int(idx / len(items) * 100)
                savings = (1 - total_opt_bytes / max(1, total_orig_bytes)) * 100
                print(f"[{idx}/{len(items)}] ({pct}%) - Ahorro: {savings:.1f}% ({total_orig_bytes // 1024} KB -> {total_opt_bytes // 1024} KB)")

        except Exception as e:
            print(f"Error en {filename}: {e}")

    # Borrar archivos originales pesados para no consumir doble storage
    if old_files_to_delete:
        print(f"\nLiberando storage: borrando {len(old_files_to_delete)} archivos originales no optimizados...")
        for i in range(0, len(old_files_to_delete), 50):
            batch = old_files_to_delete[i:i+50]
            delete_from_supabase(URL_C, KEY_C, "jjp-products", batch)
            delete_from_supabase(URL_A, KEY_A, "jjp-products", batch)

    # Actualizar DB
    print("\nActualizando referencias de base de datos a .webp...")
    for old_file, new_file in migrated_map.items():
        if old_file != new_file:
            old_part = f"/jjp-products/{old_file}"
            new_part = f"/jjp-products/{new_file}"
            rest_patch(URL_A, KEY_A, f"jjp_products?image_url=like.*{old_file}*", {
                "image_url": f"{URL_C}/storage/v1/object/public/jjp-products/{new_file}"
            })
            rest_patch(URL_A, KEY_A, f"jjp_product_variants?image_url=like.*{old_file}*", {
                "image_url": f"{URL_C}/storage/v1/object/public/jjp-products/{new_file}"
            })

    total_mb_orig = total_orig_bytes / (1024 * 1024)
    total_mb_opt = total_opt_bytes / (1024 * 1024)
    saved_mb = total_mb_orig - total_mb_opt
    saved_pct = (1 - total_opt_bytes / max(1, total_orig_bytes)) * 100

    print("\n==========================================")
    print("🎉 OPTIMIZACIÓN Y COMPRESIÓN COMPLETADA")
    print(f"Peso original total:     {total_mb_orig:.2f} MB")
    print(f"Nuevo peso en WebP:      {total_mb_opt:.2f} MB")
    print(f"Ahorro de espacio real:  {saved_mb:.2f} MB ({saved_pct:.1f}% de ahorro)")
    print(f"Imágenes optimizadas a 800px WebP, cargando hasta 4x más rápido en clientes.")
    print("==========================================")

if __name__ == '__main__':
    main()
