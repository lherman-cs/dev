#!/usr/bin/env python3
"""Packaging checks; behavior is tested with Git and Pi's SDK."""
from pathlib import Path
import json
import subprocess
root = Path(__file__).resolve().parents[1]
pkg = json.loads((root / 'pi/package.json').read_text())
lock = json.loads((root / 'pi/package-lock.json').read_text())
requested = {'@narumitw/pi-lsp', '@narumitw/pi-github-pr', '@narumitw/pi-chrome-devtools', '@narumitw/pi-usage', '@sting8k/pi-vcc', 'pi-web-access', 'pi-mcp-adapter'}
assert requested <= pkg['dependencies'].keys()
pi_package = '@earendil-works/pi-coding-agent'
pi_version = pkg['dependencies'][pi_package]
assert lock['packages']['']['dependencies'][pi_package] == pi_version
assert lock['packages'][f'node_modules/{pi_package}']['version'] == pi_version
local_pi = root / 'pi/node_modules/.bin/pi'
assert local_pi.is_file()
actual_pi_version = subprocess.check_output([local_pi, '--version'], text=True).strip()
assert actual_pi_version == pi_version, (actual_pi_version, pi_version)
assert 'pi-subagents' not in pkg['dependencies']
assert not any(p.endswith('/pi-subagents') for p in lock['packages'])
assert not (root / 'dotfiles/.omp').exists()
for name in ('auth.json', 'models.json'):
    assert not (root / f'dotfiles/.pi/agent/{name}').exists()
settings = json.loads((root / 'dotfiles/.pi/agent/settings.json').read_text())
assert settings['compaction'] == {'enabled': True, 'reserveTokens': 208000, 'keepRecentTokens': 20000}
vcc = json.loads((root / 'dotfiles/.pi/agent/pi-vcc-config.json').read_text())
assert vcc == {'overrideDefaultCompaction': True, 'smartKeepTail': True, 'continueAfterThresholdCompact': True, 'debug': False, 'skipForProviders': [], 'skipCustomTypes': []}
assert not (root / 'pi/settings.json').exists()
assert not (root / 'pi/pi-vcc-config.json').exists()
assert all(not any(c in version for c in '*^~') for version in pkg['dependencies'].values())
public_phases = ('spec', 'plan', 'build', 'ship')
internal_roles = ('review', 'explorer', 'escalated_builder')
for skill in (*public_phases, 'review', 'explore', 'ship-builder'):
    assert (root / f'pi/skills/dev-{skill}/SKILL.md').is_file()
assert set(json.loads((root / 'pi/roles.json').read_text())['roles']) == {*public_phases, *internal_roles}
for retired in ('implement', 'prepare'):
    assert not (root / f'pi/skills/dev-{retired}').exists()
for retired_module in ('workflow.ts', 'workflow-control.ts', 'workflow-types.ts'):
    assert not (root / f'pi/lib/{retired_module}').exists()
print('Pi packaging: PASS')
