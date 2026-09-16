#!/usr/bin/env python3
"""Validate review handoffs and carry exact findings; never judge their truth.

Review reports and repair packets are JSON. Full commit IDs and a contract digest
prevent a correctly formatted report for the wrong candidate from being accepted.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

MODES = {'task', 'repair', 'final', 'final-repair', 'clarification'}
SEVERITIES = {'Critical', 'Important', 'Minor'}
ID = re.compile(r'(?:R|S|Q)[1-9][0-9]*\Z')  # S/Q retain in-flight finding identities.
SHA = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})\Z')
FINDING_KEYS = {'id', 'severity', 'origin', 'location', 'failure', 'impact', 'resolution'}
REPORT_KEYS = {'schema', 'mode', 'base', 'candidate', 'contract_sha256', 'verdict',
               'findings', 'resolutions', 'checked', 'blocker', 'package_sha256'}
PACKET_KEYS = {'schema', 'candidate', 'base', 'contract_sha256', 'findings', 'seen_ids', 'family', 'repair_round'}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=_unique_object)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f'Cannot read JSON report {path}: {exc}') from exc
    require(isinstance(value, dict), 'Report must be a JSON object')
    return value


def write_new(path: Path, value: dict) -> None:
    """Exclusive creation: a concurrent dispatch cannot replace an existing packet."""
    data = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('x', encoding='utf-8') as handle:
            handle.write(data)
    except FileExistsError as exc:
        raise ValueError(f'Refusing to rewrite immutable packet: {path}') from exc


def _text(value: object, field: str) -> None:
    require(isinstance(value, str) and bool(value.strip()), f'{field} must be nonempty text')


def _keys(value: object, expected: set[str], label: str) -> None:
    require(isinstance(value, dict) and set(value) == expected, f'{label}: expected fields {sorted(expected)}')


def _findings(items: object) -> list[dict]:
    require(isinstance(items, list), 'findings must be an array')
    ids = set()
    for item in items:
        _keys(item, FINDING_KEYS, 'finding')
        for field in FINDING_KEYS:
            _text(item[field], f'finding.{field}')
        require(bool(ID.fullmatch(item['id'])), f'Invalid finding ID: {item["id"]}')
        require(item['id'] not in ids, f'Duplicate finding ID: {item["id"]}')
        ids.add(item['id'])
        require(item['severity'] in SEVERITIES, 'Invalid severity')
        require(item['origin'] in {'candidate', 'repair', 'late-discovery'}, 'Invalid finding origin')
    return items



def contract_metadata(path: Path) -> dict:
    """Only the first-line generated marker is metadata; task prose is never parsed."""
    lines = path.read_text(encoding='utf-8').splitlines()
    require(bool(lines), 'Empty task contract')
    first = lines[0]
    match = re.fullmatch(r'<!-- dev-contract: (.+) -->', first)
    require(match is not None, 'Contract needs generated metadata; repackage the bounded assignment, not the project')
    data = json.loads(match[1], object_pairs_hook=_unique_object)
    _keys(data, {'schema', 'kind', 'base'}, 'contract metadata')
    require(data['schema'] == 1 and type(data['schema']) is int, 'Invalid contract schema')
    require(data['kind'] in {'task', 'final'}, 'Invalid contract kind')
    require(isinstance(data['base'], str) and re.fullmatch(r'[0-9a-f]{7,64}', data['base']), 'Invalid contract base')
    return data


def declared_verification(path: Path, candidate: str | None = None) -> str:
    """Check declared evidence metadata, not test adequacy or the truth of agent prose."""
    text = path.read_text(encoding='utf-8')
    matches = re.findall(r'^Commit: *`?([0-9a-f]{40}|[0-9a-f]{64})`? *$', text, re.MULTILINE)
    require(len(matches) == 1, 'Validation needs exactly one full candidate Commit')
    require(candidate is None or matches[0] == candidate, 'Validation candidate is stale or different')
    require(re.findall(r'^Verification-Status: *(PASS|FAIL|BLOCKED) *$', text, re.MULTILINE) == ['PASS'],
            'Required verification must declare PASS')
    require(bool(re.search(r'^Verification:\s*\S', text, re.MULTILINE)), 'Validation needs commands/results')
    return matches[0]


def _packet(path: Path, *, base: str, contract: str) -> dict:
    packet = read_json(path)
    _keys(packet, PACKET_KEYS, 'repair packet')
    require(type(packet['schema']) is int and packet['schema'] == 2, 'Unsupported packet schema')
    require(packet['candidate'] == base, 'Repair packet does not match fix base')
    require(packet['contract_sha256'] == contract, 'Repair packet has a different task contract')
    require(isinstance(packet['family'], str) and packet['family'] in {'task', 'final'}, 'Invalid packet family')
    require(type(packet['repair_round']) is int and 0 <= packet['repair_round'] <= (2 if packet['family'] == 'task' else 1), 'Invalid repair count')
    require(isinstance(packet['base'], str) and bool(SHA.fullmatch(packet['base'])), 'Invalid packet base')
    findings = _findings(packet['findings'])
    require(bool(findings), 'Repair packet must contain blocking findings')
    require(all(f['severity'] != 'Minor' for f in findings), 'Minor finding in repair packet')
    seen = packet['seen_ids']
    require(isinstance(seen, list) and all(isinstance(x, str) and ID.fullmatch(x) for x in seen),
            'Invalid seen_ids')
    require(len(seen) == len(set(seen)), 'Duplicate seen_ids')
    require({f['id'] for f in findings} <= set(seen), 'Open finding missing from seen_ids')
    return packet


def validate(path: Path, *, base: str, candidate: str, contract: Path, mode: str,
             previous: Path | None = None, package: Path | None = None) -> tuple[dict, dict | None]:
    """Return a small envelope and, when blocked, the next exact repair packet.

    A VALID envelope validates structure/provenance, NOT software correctness.
    A real defect found late remains blocking; scripts never demote findings or
    decide causality from changed filenames (an unchanged caller can regress).
    """
    require(mode in MODES, 'Invalid review mode')
    require(bool(SHA.fullmatch(base)) and bool(SHA.fullmatch(candidate)), 'Expected full commit IDs')
    report = read_json(path)
    _keys(report, REPORT_KEYS, 'review report')
    require(type(report['schema']) is int and report['schema'] == 2, 'Unsupported review schema')
    require(report['mode'] == mode, 'Review mode does not match assignment')
    require(report['base'] == base, 'Review base does not match assignment')
    require(report['candidate'] == candidate, 'Review candidate does not match assignment')
    require(isinstance(report['package_sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', report['package_sha256']), 'Invalid package digest')
    if package is not None:
        require(report['package_sha256'] == digest(package), 'Review package is stale or changed')
    contract_hash = digest(contract)
    require(report['contract_sha256'] == contract_hash, 'Review task contract is stale or different')
    _text(report['verdict'], 'verdict')
    require(report['verdict'] in {'PASS', 'FIXES_REQUIRED', 'BLOCKED'}, 'Invalid verdict')
    require(isinstance(report['blocker'], str), 'blocker must be text')
    require(isinstance(report['checked'], list) and bool(report['checked']), 'checked must contain evidence anchors')
    for item in report['checked']:
        _text(item, 'checked evidence')
    new = _findings(report['findings'])
    require(isinstance(report['resolutions'], list), 'resolutions must be an array')
    is_repair = mode in {'repair', 'final-repair'}
    active = []
    seen = set()
    family = 'final' if mode.startswith('final') else 'task'
    repair_round = 0
    continuation = mode == 'clarification'
    if is_repair or continuation:
        require(previous is not None, 'Scoped rereview requires the previous repair packet')
        if is_repair:
            require(base != candidate, 'A reviewed repair requires a new candidate, not report clarification')
        packet = _packet(previous, base=candidate if continuation else base, contract=contract_hash)
        if continuation:
            require(packet['base'] == base, 'Clarification must preserve the entire reviewed range')
            family = packet['family']
        else:
            require(packet['family'] == family, 'Repair cannot change task/final review family')
        repair_round = packet['repair_round'] + int(is_repair)
        require(repair_round <= (2 if family == 'task' else 1), 'Reviewed repair limit reached; do not reset history or waive blockers')
        old = {f['id']: f for f in packet['findings']}
        seen = set(packet['seen_ids'])
        resolved_ids = set()
        for item in report['resolutions']:
            _keys(item, {'id', 'status', 'evidence'}, 'resolution')
            _text(item['id'], 'resolution.id')
            require(item['id'] in old and item['id'] not in resolved_ids, 'Unknown or duplicate resolution ID')
            _text(item['status'], 'resolution.status')
            require(item['status'] in ({'WITHDRAWN', 'DOWNGRADED', 'UNRESOLVED'} if continuation else {'RESOLVED', 'UNRESOLVED'}), 'Invalid resolution status')
            _text(item['evidence'], 'resolution.evidence')
            resolved_ids.add(item['id'])
            if item['status'] == 'UNRESOLVED':
                active.append(old[item['id']])
        require(resolved_ids == set(old), 'Every previous blocker needs an explicit resolution verdict')
        require(continuation or all(f['origin'] in {'repair', 'late-discovery'} for f in new),
                'A new rereview finding needs repair causality or explicit late-discovery classification')
    else:
        require(previous is None, 'Initial review cannot consume a repair packet')
        require(not report['resolutions'], 'Initial review cannot resolve historical findings')
        require(all(f['origin'] == 'candidate' for f in new), 'Initial findings must be candidate-bounded')
    require(not seen.intersection(f['id'] for f in new), 'Finding ID reused; preserve existing IDs in resolutions')
    active += [f for f in new if f['severity'] != 'Minor']
    seen.update(f['id'] for f in new)
    if report['verdict'] == 'PASS':
        require(not active and not report['blocker'].strip(), 'PASS cannot carry a blocker')
    elif report['verdict'] == 'FIXES_REQUIRED':
        require(bool(active) and not report['blocker'].strip(), 'FIXES_REQUIRED needs concrete findings, not a routing blocker')
    else:
        require(bool(report['blocker'].strip()), 'BLOCKED needs a concrete missing evidence/authority explanation')
    packet = None
    if active:
        packet = {'schema': 2, 'candidate': candidate, 'base': base, 'contract_sha256': contract_hash,
                  'family': family, 'repair_round': repair_round, 'findings': active, 'seen_ids': sorted(seen)}
    envelope = {'status': 'VALID', 'verdict': report['verdict'], 'candidate': candidate,
                'report': str(path), 'repair_round': repair_round,
                'minor_ids': [f['id'] for f in new if f['severity'] == 'Minor'], 'blocking_ids': [f['id'] for f in active],
                'late_discovery_ids': [f['id'] for f in new if f['origin'] == 'late-discovery' and f['severity'] != 'Minor']}
    if report['blocker'].strip():
        envelope['blocker'] = report['blocker']
    return envelope, packet
