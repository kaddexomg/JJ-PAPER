#!/bin/bash
set -e

echo "=== Configurando entorno wa-server para JJ Paper en VPS ==="
cd /opt/jj-paper/wa-server

cat << 'EOF' > .env
# PROYECTO A — Core
SUPABASE_URL_CORE=https://wwcdxqpibequfohbgejs.supabase.co
SUPABASE_SERVICE_ROLE_KEY_CORE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Y2R4cXBpYmVxdWZvaGJnZWpzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDczMDA3NCwiZXhwIjoyMTA2MzA2MDc0fQ.FhQjv5Ay6PF6ClL4jlwV_9kYi_XnKjezAQ8L6pD04zg

# PROYECTO B — Comunicación (WhatsApp, Email, Difusión)
SUPABASE_URL_COMM=https://klcibjwleiqppedefpxw.supabase.co
SUPABASE_SERVICE_ROLE_KEY_COMM=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsY2liandsZWlxcHBlZGVmcHh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzc1MTc5NiwiZXhwIjoyMTAzMzI3Nzk2fQ.gk-Ch2njS3f-GUvqRzS5v4hH3tJ56bdo5ixOs_xOuWA

# Compatibilidad estándar
SUPABASE_URL=https://klcibjwleiqppedefpxw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsY2liandsZWlxcHBlZGVmcHh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzc1MTc5NiwiZXhwIjoyMTAzMzI3Nzk2fQ.gk-Ch2njS3f-GUvqRzS5v4hH3tJ56bdo5ixOs_xOuWA

PORT=8787
NODE_ENV=production

# Correo por Google OAuth
GOOGLE_CLIENT_ID=966811384264-4ciph62d7inqh38t90ig98omsa6jj326.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
EOF

echo "✓ Archivo .env configurado con éxito"

# Iniciar o reiniciar con PM2
pm2 delete wa-server 2>/dev/null || true
pm2 start src/index.js --name "wa-server"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "=== wa-server corriendo 24/7 en PM2 ==="
pm2 status
