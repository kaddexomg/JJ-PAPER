import pathlib
import re
import time
from deep_translator import GoogleTranslator

root = pathlib.Path(__file__).resolve().parent
translator = GoogleTranslator(source='en', target='es')


def translate_line(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return line
    if stripped == '---':
        return line
    if re.match(r'^(name|metadata|origin):', line):
        return line
    if line.startswith('description:'):
        value = line.split(':', 1)[1].strip()
        if not value:
            return line
        translated = translator.translate(value)
        return f'description: {translated if translated is not None else value}'

    try:
        translated = translator.translate(line)
        return translated if translated is not None else line
    except Exception:
        return line


def translate_text(text: str) -> str:
    out = []
    in_code = False
    for line in text.splitlines():
        if line.startswith('```'):
            in_code = not in_code
            out.append(line)
            continue
        if in_code:
            out.append(line)
            continue
        out.append(translate_line(line))
    return '\n'.join(out).rstrip() + '\n'


count = 0
for entry in sorted(root.iterdir()):
    if not entry.is_dir():
        continue
    skill_path = entry / 'SKILL.md'
    es_path = entry / 'SKILL_ES.md'
    if not skill_path.exists():
        continue
    try:
        text = skill_path.read_text(encoding='utf-8')
        translated = translate_text(text)
        es_path.write_text(translated, encoding='utf-8')
        count += 1
        print(f'[{count}] {entry.name}')
        time.sleep(0.8)
    except Exception as exc:
        print(f'ERROR {entry.name}: {exc}')

print(f'Finished: {count} files rewritten')
