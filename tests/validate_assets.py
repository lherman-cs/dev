#!/usr/bin/env python3
"""Packaging checks; behavior is tested with real Git, TOON, and Pi's SDK."""
from pathlib import Path
import json
root = Path(__file__).resolve().parents[1]
pkg = json.loads((root / 'pi/package.json').read_text())
lock = json.loads((root / 'pi/package-lock.json').read_text())
requested = {'@narumitw/pi-lsp', '@narumitw/pi-github-pr', '@narumitw/pi-chrome-devtools', '@narumitw/pi-usage', 'pi-web-access', 'pi-mcp-adapter'}
assert requested <= pkg['dependencies'].keys()
assert 'pi-subagents' not in pkg['dependencies']
assert not any(p.endswith('/pi-subagents') for p in lock['packages'])
assert not (root / 'dotfiles/.omp').exists()
for name in ('settings.json', 'auth.json', 'models.json'):
    assert not (root / f'dotfiles/.pi/agent/{name}').exists()
assert all(not any(c in version for c in '*^~') for version in pkg['dependencies'].values())
for phase in ('spec', 'plan', 'implement', 'prepare', 'review'):
    assert (root / f'pi/skills/dev-{phase}/SKILL.md').is_file()
print('Pi packaging: PASS')
