#!/usr/bin/env python3
"""Exercise the COMPILED Rust launcher against a recording Codex stub; never call an LLM.
Run after cargo build --locked: python3 tests/launcher_e2e.py --binary target/debug/dev
This tests real Rust argv generation, not real Codex tool availability/behavior.
"""
from pathlib import Path
import argparse
import json
import os
import shlex
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    binary = parser.parse_args().binary.resolve()
    if not binary.is_file():
        raise SystemExit(f'Compiled binary missing: {binary}. Run cargo build --locked first.')
    if os.name != 'posix':
        raise SystemExit('The executable recording shim currently requires a POSIX host.')
    with tempfile.TemporaryDirectory(prefix='dev launcher ') as tmp:
        tmp = Path(tmp)
        bindir, home = tmp / 'bin', tmp / 'codex home'
        bindir.mkdir(); home.mkdir()
        config = home / 'config.toml'
        original = b'# Preserve this file verbatim\nmodel="keep-me"\n'
        config.write_bytes(original)
        capture = tmp / 'capture.json'
        shim = bindir / 'codex'
        shim.write_text(f'#!{sys.executable}\nimport json, os, sys\n'
                        'from pathlib import Path\n'
                        'Path(os.environ["DEV_TEST_CAPTURE"]).write_text(json.dumps(sys.argv[1:]))\n')
        shim.chmod(0o755)
        env = dict(os.environ, PATH=str(bindir)+os.pathsep+os.environ.get('PATH',''),
                   CODEX_HOME=str(home), DEV_TEST_CAPTURE=str(capture))
        def run(*args: str) -> subprocess.CompletedProcess:
            return subprocess.run([str(binary), 'a', *args], env=env, cwd=tmp,
                                  text=True, capture_output=True, check=True)
        def launch(*args: str) -> list[str]:
            capture.unlink(missing_ok=True)
            run(*args)
            assert config.read_bytes() == original, 'Launcher modified user config'
            return json.loads(capture.read_text())
        def parse_overrides(args: list[str]) -> dict:
            result = {}; i = 0
            while i < len(args) and args[i] == '-c':
                key, val = args[i+1].split('=', 1)
                result[key] = tomllib.loads('value='+val)['value']; i += 2
            return result
        profiles = tomllib.loads((ROOT / 'agent.toml').read_text())['profiles']
        for command in ('spec','plan','build','review','project','explore'):
            for task in ([], ['Task with spaces, "quotes", and $literal']):
                args = launch(command, *task)
                options = parse_overrides(args)
                role_name = profiles[command]['role']
                source = tomllib.loads((ROOT / f'dotfiles/.codex/agents/{role_name}.toml').read_text())
                assert options['model'] == source['model']
                assert options['model_reasoning_effort'] == source['model_reasoning_effort']
                assert options['sandbox_mode'] == source['sandbox_mode']
                assert 'developer_instructions' not in options
                assert args[-2] == '--' and 'Role contract:' in args[-1]
                assert ('No assignment supplied yet' in args[-1]) == (not task)
                for role_file in (ROOT / 'dotfiles/.codex/agents').glob('*.toml'):
                    role = tomllib.loads(role_file.read_text())
                    runtime = Path(options[f'agents.{role["name"]}.config_file'])
                    assert runtime.is_absolute() and runtime.is_file()
                    generated = tomllib.loads(runtime.read_text())
                    assert generated['model'] == role['model']
                    assert generated['model_reasoning_effort'] == role['model_reasoning_effort']
                    assert 'exact bundled skill source' in generated['developer_instructions']
        # Trust session: no task injected. Aliases dispatch the expected roles.
        args = launch()
        assert '--' not in args and 'Role contract:' not in '\n'.join(args)
        for alias in ('s','p','b','r','e','pr','specifier','orchestrate'):
            assert launch(alias, 'task')[-2] == '--'
        assert launch('resume') == ['resume']
        assert launch('resume', '--last') == ['resume', '--last']
        assert launch('resume', 'session-id') == ['resume', '--', 'session-id']
        # --args is shell-quoted and parseable; config inspection must not mutate config.
        result = run('config', '--profile', 'spec', '--args')
        args = shlex.split(result.stdout)
        assert parse_overrides(args)['model'] == profiles_model('spec')
        assert config.read_bytes() == original
        print(json.dumps({'status':'PASS', 'kind':'compiled Rust launcher with Codex stub',
                          'role_launch_cases':12, 'alias_cases':8,
                          'live_codex_executed':False}, indent=2))

def profiles_model(profile: str) -> str:
    role = tomllib.loads((ROOT / 'agent.toml').read_text())['profiles'][profile]['role']
    return tomllib.loads((ROOT / f'dotfiles/.codex/agents/{role}.toml').read_text())['model']

if __name__ == '__main__':
    main()
