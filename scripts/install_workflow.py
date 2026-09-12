#!/usr/bin/env python3
"""Copy only the six workflow roles/skills into a target worktree; preserve user config.
Changed existing workflow files are backed up; no bootstrap/install.sh is run.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def reject_symlink_parents(target: Path, destination: Path) -> None:
    """Do not follow a .codex/.agents directory symlink outside the target worktree."""
    current = target
    for part in destination.parent.relative_to(target).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f'Refusing a symlinked workflow parent directory: {current}')
        if current.exists() and not current.is_dir():
            raise ValueError(f'Workflow parent is not a directory: {current}')

def install(target: Path, source: Path = ROOT, dry_run: bool = False) -> dict:
    target = target.resolve(strict=True)
    if not target.is_dir():
        raise ValueError(f'Worktree is not a directory: {target}')
    assets = []
    for directory in ('dotfiles/.codex/agents', 'dotfiles/.agents/skills'):
        for path in sorted((source/directory).rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts:
                assets.append((path, path.relative_to(source/'dotfiles')))
    backup = target/'.codex/dev-workflow-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    # Preflight all destinations before writing any asset.
    for _, rel in assets:
        reject_symlink_parents(target, target/rel)
        reject_symlink_parents(target, backup/rel)
        if (target/rel).is_dir() and not (target/rel).is_symlink():
            raise ValueError(f'Refusing to replace a directory with an asset: {target/rel}')
    changed = []; backed_up = []
    for src, rel in assets:
        dest = target/rel
        contents = src.read_bytes()
        if dest.is_file() and not dest.is_symlink() and dest.read_bytes() == contents:
            continue
        changed.append(str(rel))
        if dry_run:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() or dest.is_symlink():
            if dest.is_dir() and not dest.is_symlink():
                raise ValueError(f'Refusing to replace a directory with an asset: {dest}')
            saved = backup/rel; saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, saved, follow_symlinks=False); backed_up.append(str(rel))
        fd, name = tempfile.mkstemp(prefix='.dev-workflow-', dir=dest.parent)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(contents)
            os.chmod(name, 0o644)
            os.replace(name, dest)
        finally:
            Path(name).unlink(missing_ok=True)
    return {'changed':changed, 'backed_up':backed_up,
            'backup_path':str(backup) if backed_up else None, 'dry_run':dry_run}

if __name__ == '__main__':
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('worktree', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    print(json.dumps(install(args.worktree, dry_run=args.dry_run), indent=2))
