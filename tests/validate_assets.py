#!/usr/bin/env python3
"""Packaging checks; behavior is tested with Git and Pi's SDK."""
from pathlib import Path
import json
import subprocess
root = Path(__file__).resolve().parents[1]
pkg = json.loads((root / 'pi/package.json').read_text())
lock = json.loads((root / 'pi/package-lock.json').read_text())
pi_package = '@earendil-works/pi-coding-agent'
pi_version = pkg['dependencies'][pi_package]
assert lock['packages']['']['dependencies'][pi_package] == pi_version
assert lock['packages'][f'node_modules/{pi_package}']['version'] == pi_version
local_pi = root / 'pi/node_modules/.bin/pi'
assert local_pi.is_file()
actual_pi_version = subprocess.check_output([local_pi, '--version'], text=True).strip()
assert actual_pi_version == pi_version, (actual_pi_version, pi_version)
for name in ('auth.json', 'models.json'):
    assert not (root / f'dotfiles/.pi/agent/{name}').exists()
assert all(not any(c in version for c in '*^~') for version in pkg['dependencies'].values())
print('Pi packaging: PASS')
