#!/usr/bin/env python3
"""Review packet protocol tests. Formatting/provenance checks, not LLM verdicts."""
from __future__ import annotations
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
TOOLS=ROOT/'dotfiles/.agents/skills/dev-project/scripts'
sys.path.insert(0,str(TOOLS))
import review_report as rr

A='a'*40; B='b'*40; C='c'*40

def finding(id='R1',severity='Important',origin='candidate',location='src/retry.rs:42'):
    return dict(id=id,severity=severity,origin=origin,location=location,
                failure='A rejected write advances the delivery cursor.',
                impact='The next retry skips the undelivered packet.',
                resolution='Keep the cursor unchanged on rejection; exercise the production retry path.')

class ReviewReportsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.contract=self.root/'brief.md'
        self.contract.write_text('Required: retries preserve undelivered packets.\n')
        self.path=self.root/'review.json'

    def report(self,**changes):
        result=dict(schema=1,mode='task',base=A,candidate=B,
                    contract_sha256=rr.digest(self.contract),verdict='PASS',findings=[],
                    resolutions=[],checked=['src/retry.rs:40-60; tests/retry.rs:12'],blocker='')
        result.update(changes); return result

    def check(self,report,**options):
        self.path.write_text(json.dumps(report))
        defaults=dict(base=A,candidate=B,contract=self.contract,mode='task')
        defaults.update(options)
        return rr.validate(self.path,**defaults)

    def prior(self):
        report=self.report(verdict='FIXES_REQUIRED',findings=[finding()])
        _,packet=self.check(report)
        path=self.root/'repair.json'; rr.write_new(path,packet); return path

    def repair(self,**changes):
        result=self.report(mode='repair',base=B,candidate=C,
                           resolutions=[dict(id='R1',status='RESOLVED',evidence='src/retry.rs:44 now advances after success')])
        result.update(changes); return result

    def test_valid_envelope_is_not_an_unconditional_pass(self):
        envelope,packet=self.check(self.report())
        self.assertEqual(envelope['status'],'VALID'); self.assertEqual(envelope['verdict'],'PASS')
        self.assertIsNone(packet); self.assertNotIn('checked',envelope)

    def test_exact_findings_carried_without_paraphrase(self):
        f=finding(); f['failure']='Unicode: café 🛰️, paths with spaces, "quoted" input.\nExact second line.'
        envelope,packet=self.check(self.report(verdict='FIXES_REQUIRED',findings=[f]))
        self.assertEqual(packet['findings'],[f]); self.assertEqual(envelope['blocking_ids'],['R1'])
        self.assertNotIn(f['failure'],json.dumps(envelope))

    def test_minor_only_is_pass_without_repair(self):
        envelope,packet=self.check(self.report(findings=[finding(severity='Minor')]))
        self.assertEqual(envelope['blocking_ids'],[]); self.assertIsNone(packet)

    def test_pass_with_real_blocker_rejected(self):
        with self.assertRaisesRegex(ValueError,'PASS cannot'): self.check(self.report(findings=[finding()]))

    def test_fixes_required_without_blocker_rejected(self):
        with self.assertRaisesRegex(ValueError,'concrete findings'):
            self.check(self.report(verdict='FIXES_REQUIRED',findings=[finding(severity='Minor')]))

    def test_blocked_requires_reason_not_fake_pass(self):
        with self.assertRaisesRegex(ValueError,'concrete missing'): self.check(self.report(verdict='BLOCKED'))
        envelope,packet=self.check(self.report(verdict='BLOCKED',blocker='Required artifact is missing.'))
        self.assertEqual(envelope['verdict'],'BLOCKED'); self.assertIsNone(packet)

    def test_wrong_assignment_fields_rejected(self):
        for field,value in [('base',C),('candidate',C),('mode','final'),('contract_sha256','0'*64)]:
            with self.subTest(field=field),self.assertRaises(ValueError): self.check(self.report(**{field:value}))

    def test_contract_content_change_invalidates_review(self):
        report=self.report(); self.contract.write_text('Required: changed contract.')
        with self.assertRaisesRegex(ValueError,'stale or different'): self.check(report)

    def test_full_commit_ids_required(self):
        with self.assertRaisesRegex(ValueError,'full commit'): self.check(self.report(),candidate=B[:7])

    def test_duplicate_json_keys_rejected(self):
        self.path.write_text('{"schema":1,"schema":1}')
        with self.assertRaisesRegex(ValueError,'Duplicate JSON key'):
            rr.validate(self.path,base=A,candidate=B,contract=self.contract,mode='task')

    def test_invalid_and_nonobject_json_rejected(self):
        for text in ['{broken','[]','null','"PASS"']:
            with self.subTest(text=text):
                self.path.write_text(text)
                with self.assertRaises(ValueError): rr.validate(self.path,base=A,candidate=B,contract=self.contract,mode='task')

    def test_unknown_fields_or_missing_fields_rejected(self):
        report=self.report(); report['extra']='not part of contract'
        with self.assertRaisesRegex(ValueError,'expected fields'): self.check(report)
        report=self.report(); del report['mode']
        with self.assertRaisesRegex(ValueError,'expected fields'): self.check(report)

    def test_invalid_types_fail_cleanly(self):
        for field,value in [('schema',True),('schema',1.0),('verdict',{}),('verdict',None),
                            ('findings',{}),('resolutions',None),('checked',[]),('checked',[None]),('blocker',[])]:
            with self.subTest(field=field,value=value), self.assertRaises(ValueError):
                self.check(self.report(**{field:value}))

    def test_incomplete_or_duplicate_findings_rejected(self):
        for change in [dict(severity='Maybe'),dict(origin='opinion'),dict(failure=''),dict(id='R0'),dict(impact=[]),dict(location=None)]:
            f=finding(); f.update(change)
            with self.subTest(change=change),self.assertRaises(ValueError): self.check(self.report(verdict='FIXES_REQUIRED',findings=[f]))
        with self.assertRaisesRegex(ValueError,'Duplicate finding'):
            self.check(self.report(verdict='FIXES_REQUIRED',findings=[finding(),finding()]))

    def test_initial_cannot_claim_prior_resolutions(self):
        with self.assertRaisesRegex(ValueError,'historical findings'):
            self.check(self.report(resolutions=[dict(id='R1',status='RESOLVED',evidence='assertion')]))

    def test_successful_repair_verdict(self):
        previous=self.prior()
        envelope,packet=self.check(self.repair(),base=B,candidate=C,mode='repair',previous=previous)
        self.assertEqual(envelope['verdict'],'PASS'); self.assertIsNone(packet)

    def test_every_blocker_needs_resolution(self):
        previous=self.prior()
        for resolutions in [[],[dict(id='R2',status='RESOLVED',evidence='wrong ID')],
                            [dict(id='R1',status='RESOLVED',evidence='yes')]*2,
                            [dict(id='R1',status='RESOLVED',evidence='')],
                            [dict(id='R1',status={},evidence='not a verdict')]]:
            with self.subTest(resolutions=resolutions),self.assertRaises(ValueError):
                self.check(self.repair(resolutions=resolutions),base=B,candidate=C,mode='repair',previous=previous)

    def test_unresolved_finding_is_carried_exactly(self):
        previous=self.prior(); prior=rr.read_json(previous)
        report=self.repair(verdict='FIXES_REQUIRED',resolutions=[dict(id='R1',status='UNRESOLVED',evidence='same failure persists')])
        envelope,packet=self.check(report,base=B,candidate=C,mode='repair',previous=previous)
        self.assertEqual(packet['findings'],prior['findings']); self.assertEqual(envelope['blocking_ids'],['R1'])

    def test_unresolved_finding_cannot_pass(self):
        previous=self.prior()
        with self.assertRaisesRegex(ValueError,'PASS cannot'):
            self.check(self.repair(resolutions=[dict(id='R1',status='UNRESOLVED',evidence='still broken')]),
                       base=B,candidate=C,mode='repair',previous=previous)

    def test_missing_previous_or_wrong_fix_base_rejected(self):
        with self.assertRaisesRegex(ValueError,'previous repair packet'):
            self.check(self.repair(),base=B,candidate=C,mode='repair')
        previous=self.prior()
        with self.assertRaisesRegex(ValueError,'fix base'):
            self.check(self.repair(base=A),base=A,candidate=C,mode='repair',previous=previous)

    def test_clarification_is_not_a_new_repair_candidate(self):
        previous=self.prior()
        with self.assertRaisesRegex(ValueError,'new candidate'):
            self.check(self.repair(candidate=B),base=B,candidate=B,mode='repair',previous=previous)

    def test_new_regression_in_unchanged_caller_is_allowed(self):
        previous=self.prior(); f=finding(id='R2',origin='repair',location='unchanged/caller.rs:90')
        envelope,packet=self.check(self.repair(verdict='FIXES_REQUIRED',findings=[f]),
                                   base=B,candidate=C,mode='repair',previous=previous)
        self.assertEqual(packet['findings'],[f]); self.assertEqual(packet['seen_ids'],['R1','R2'])

    def test_late_serious_discovery_is_not_demoted_by_script(self):
        previous=self.prior(); f=finding(id='R2',severity='Critical',origin='late-discovery')
        envelope,packet=self.check(self.repair(verdict='FIXES_REQUIRED',findings=[f]),
                                   base=B,candidate=C,mode='repair',previous=previous)
        self.assertEqual(envelope['late_discovery_ids'],['R2'])
        self.assertEqual(packet['findings'][0]['severity'],'Critical')

    def test_new_rereview_finding_needs_classification(self):
        previous=self.prior()
        with self.assertRaisesRegex(ValueError,'causality'):
            self.check(self.repair(verdict='FIXES_REQUIRED',findings=[finding('R2')]),
                       base=B,candidate=C,mode='repair',previous=previous)

    def test_resolved_ids_cannot_be_reused(self):
        previous=self.prior()
        with self.assertRaisesRegex(ValueError,'ID reused'):
            self.check(self.repair(verdict='FIXES_REQUIRED',findings=[finding(origin='repair')]),
                       base=B,candidate=C,mode='repair',previous=previous)

    def test_invalid_packet_rejected(self):
        previous=self.prior(); original=rr.read_json(previous)
        variants=[dict(seen_ids=[]),dict(seen_ids=['R1','R1']),dict(seen_ids=[{}]),dict(schema=True),
                  dict(contract_sha256='0'*64),dict(findings=[finding(severity='Minor')]),dict(findings=[])]
        for change in variants:
            with self.subTest(change=change):
                packet=deepcopy(original); packet.update(change); previous.write_text(json.dumps(packet))
                with self.assertRaises(ValueError):
                    self.check(self.repair(),base=B,candidate=C,mode='repair',previous=previous)

    def test_final_review_and_final_repair_use_same_persona_protocol(self):
        _,packet=self.check(self.report(mode='final',verdict='FIXES_REQUIRED',findings=[finding()]),mode='final')
        previous=self.root/'final-repair.json'; rr.write_new(previous,packet)
        envelope,_=self.check(self.repair(mode='final-repair'),base=B,candidate=C,mode='final-repair',previous=previous)
        self.assertEqual(envelope['verdict'],'PASS')

    def test_legacy_ids_retained(self):
        envelope,packet=self.check(self.report(verdict='FIXES_REQUIRED',findings=[finding('S1'),finding('Q1')]))
        self.assertEqual(envelope['blocking_ids'],['S1','Q1']); self.assertEqual(len(packet['findings']),2)

    def test_immutable_packet_and_symlink_not_overwritten(self):
        path=self.root/'out.json'; rr.write_new(path,{'hello':'world'}); before=path.read_bytes()
        with self.assertRaisesRegex(ValueError,'immutable'): rr.write_new(path,{'bad':True})
        self.assertEqual(path.read_bytes(),before)
        link=self.root/'symlink.json'; link.symlink_to(path)
        with self.assertRaisesRegex(ValueError,'immutable'): rr.write_new(link,{'bad':True})
        self.assertEqual(path.read_bytes(),before)

if __name__=='__main__': unittest.main()
