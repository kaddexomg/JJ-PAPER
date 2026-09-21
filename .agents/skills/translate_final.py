#!/usr/bin/env python3
"""
Traductor robusto de skills al español usando MyMemory API
- Manejo de errores mejorado
- Reintentos automáticos
- Progreso visual
"""

import pathlib
import re
import time
import urllib.parse
import urllib.request
import json
import sys
from typing import Optional

root = pathlib.Path(__file__).resolve().parent

def translate_text(text: str, retries: int = 3) -> Optional[str]:
    """Traduce texto usando MyMemory API con reintentos"""
    if not text or not text.strip():
        return text
    
    # Limitar longitud para evitar errores de URL
    text_to_translate = text[:500] if len(text) > 500 else text
    
    for attempt in range(retries):
        try:
            encoded = urllib.parse.quote(text_to_translate)
            url = f"https://api.mymemory.translated.net/get?q={encoded}&langpair=en|es"
            
            with urllib.request.urlopen(url, timeout=5) as response:
                data = json.loads(response.read().decode('utf-8'))
                if data.get('responseStatus') == 200:
                    translated = data['responseData'].get('translatedText', text)
                    return translated if translated else text
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1))
                continue
            return text
    
    return text

def translate_line(line: str) -> str:
    """Traduce una línea preservando estructura YAML"""
    stripped = line.strip()
    
    # No traducir líneas vacías
    if not stripped:
        return line
    
    # No traducir delimitadores
    if stripped == '---':
        return line
    
    # No traducir metadatos YAML especiales
    if any(stripped.startswith(x) for x in ['name:', 'metadata:', 'origin:', 'file:']):
        return line
    
    # Traducir descripción
    if stripped.startswith('description:'):
        value = stripped.split(':', 1)[1].strip()
        if value:
            translated = translate_text(value)
            return f'description: {translated}'
        return line
    
    # Traducir otras líneas normales
    if ':' not in line or line.strip().startswith('#'):
        translated = translate_text(stripped)
        # Preservar indentación original
        indent = len(line) - len(line.lstrip())
        return ' ' * indent + translated if translated else line
    
    return line

def translate_file(input_path: pathlib.Path, output_path: pathlib.Path) -> bool:
    """Traduce un archivo SKILL.md completo"""
    try:
        content = input_path.read_text(encoding='utf-8')
        lines = content.split('\n')
        translated_lines = []
        in_code = False
        in_frontmatter = False
        frontmatter_end = -1
        
        # Encontrar fin del frontmatter
        for i, line in enumerate(lines):
            if i > 0 and line.strip() == '---':
                frontmatter_end = i
                break
        
        # Procesar línea por línea
        for i, line in enumerate(lines):
            # Preservar frontmatter
            if i <= frontmatter_end:
                translated_lines.append(line)
                continue
            
            # Detectar bloques de código
            if line.strip().startswith('```'):
                in_code = not in_code
                translated_lines.append(line)
                continue
            
            # No traducir dentro de bloques de código
            if in_code:
                translated_lines.append(line)
                continue
            
            # Traducir línea de contenido
            translated_line = translate_line(line)
            translated_lines.append(translated_line)
            time.sleep(0.1)  # Rate limiting suave
        
        # Guardar archivo traducido
        translated_content = '\n'.join(translated_lines)
        output_path.write_text(translated_content, encoding='utf-8')
        return True
        
    except Exception as e:
        print(f"ERROR {input_path.parent.name}: {e}", file=sys.stderr)
        return False

# Procesar todas las skills
completed = 0
total_skills = len(list(root.glob('*/SKILL.md')))

print("\n" + "="*60)
print("TRADUCCIÓN AL ESPAÑOL - MODO ROBUSTO")
print("="*60 + "\n")

for entry in sorted(root.iterdir()):
    if not entry.is_dir() or entry.name.startswith('.'):
        continue
    
    skill_path = entry / 'SKILL.md'
    es_path = entry / 'SKILL-es.md'
    
    if not skill_path.exists():
        continue
    
    if translate_file(skill_path, es_path):
        completed += 1
        pct = int((completed / total_skills) * 100)
        print(f"[{pct:3d}%] ✅ {entry.name}")
    else:
        print(f"[---] ❌ {entry.name}")

print(f"\n{'='*60}")
print(f"✅ COMPLETADO: {completed}/{total_skills} skills traducidas")
print(f"{'='*60}\n")
