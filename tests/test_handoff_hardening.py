"""Local negative/positive controls for the handoff boundaries. No model calls."""
from pathlib import Path
import json
import tempfile
import unittest
import test_workflow_tools as tw
import package_review
import review_report as rr
import validate_workflow as vw


class HandoffHardeningTests(unittest.TestCase):
    def setUp(self):
        self.f = tw.WorkflowToolsTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.repo = self.f.repo
        self.n = 0

    def defect(self):
        return dict(id='R1',severity='Important',origin='candidate',location='source:1',
                    failure='An admitted retry loses data.',impact='Data loss.',
                    resolution='Keep delivery state on a rejected send.')

    def gate(self, *, mode='task', base=None, candidate=None, previous=None,
             validation=None, **changes):
        self.n += 1
        base = base or self.f.base
        candidate = candidate or self.f.candidate
        contract = self.f.contract
        package = self.repo/f'package-{self.n}.md'
        package.write_text(package_review.render(self.repo,base,candidate,contract,previous,validation)[0])
        data = dict(schema=2,mode=mode,base=base,candidate=candidate,
                    contract_sha256=rr.digest(contract),package_sha256=rr.digest(package),
                    verdict='PASS',findings=[],resolutions=[],checked=['source:1 actual path'],blocker='')
        data.update(changes)
        report = self.repo/f'review-{self.n}.json'
        report.write_text(json.dumps(data))
        packet = self.repo/f'packet-{self.n}.json'
        result = vw.check_reviews([report],repo=self.repo,base=base,candidate=candidate,
                                  contract=contract,mode=mode,previous=previous,
                                  repair_output=packet,package=package,validation=validation)
        return result, packet, report, package

    def test_initial_partial_diff_cannot_approve(self):
        self.f.git('commit','--allow-empty','-qm','later part')
        head = self.f.git('rev-parse','HEAD')
        with self.assertRaisesRegex(ValueError,'BASE differs'):
            package_review.render(self.repo,self.f.candidate,head,self.f.contract)

    def test_complete_task_range_is_allowed(self):
        result,_,_,_ = self.gate()
        self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(result['repair_round'],0)

    def test_missing_generated_contract_cannot_gate(self):
        self.f.contract.write_text('Task only, no generated base.')
        with self.assertRaisesRegex(ValueError,'generated metadata'):
            self.gate()

    def test_empty_contract_fails_cleanly(self):
        self.f.contract.write_text('')
        with self.assertRaisesRegex(ValueError,'Empty task contract'):
            self.gate()

    def test_package_tampering_cannot_pass(self):
        _,_,report,package = self.gate()
        package.write_text(package.read_text().replace('+candidate','+different'))
        with self.assertRaisesRegex(ValueError,'stale, altered'):
            vw.check_reviews([report],repo=self.repo,base=self.f.base,candidate=self.f.candidate,
                             contract=self.f.contract,mode='task',package=package)

    def test_correct_package_with_wrong_report_digest_fails(self):
        with self.assertRaisesRegex(ValueError,'package is stale'):
            self.gate(package_sha256='0'*64)

    def test_blocked_findings_get_a_continuation_packet(self):
        result,packet,_,_ = self.gate(verdict='BLOCKED',findings=[self.defect()],blocker='Need one caller contract.')
        self.assertEqual(rr.read_json(packet)['findings'],[self.defect()])
        self.assertEqual(result['blocking_ids'],['R1'])
        self.assertEqual(result['repair_packet'],str(packet))

    def test_clarification_cannot_drop_a_previous_blocker(self):
        _,previous,_,_ = self.gate(verdict='BLOCKED',findings=[self.defect()],blocker='Need one caller contract.')
        with self.assertRaisesRegex(ValueError,'Every previous blocker'):
            self.gate(mode='clarification',previous=previous)

    def test_clarification_can_withdraw_a_mistaken_finding_without_repair(self):
        _,previous,_,_ = self.gate(verdict='BLOCKED',findings=[self.defect()],blocker='Need caller evidence.')
        result,_,_,_ = self.gate(mode='clarification',previous=previous,
                               resolutions=[dict(id='R1',status='WITHDRAWN',evidence='source:1 rejects before state mutation.')])
        self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(result['repair_round'],0)

    def test_confirmed_defect_stays_blocking_during_clarification(self):
        _,previous,_,_ = self.gate(verdict='FIXES_REQUIRED',findings=[self.defect()])
        with self.assertRaisesRegex(ValueError,'PASS cannot'):
            self.gate(mode='clarification',previous=previous,
                      resolutions=[dict(id='R1',status='UNRESOLVED',evidence='Failure is still reachable.')])

    def test_three_task_repairs_cannot_reset_the_budget(self):
        _,previous,_,_ = self.gate(verdict='FIXES_REQUIRED',findings=[self.defect()])
        base = self.f.candidate
        for count in (1,2):
            self.f.git('commit','--allow-empty','-qm',f'attempt {count}')
            candidate = self.f.git('rev-parse','HEAD')
            result,previous,_,_ = self.gate(mode='repair',base=base,candidate=candidate,previous=previous,
                 verdict='FIXES_REQUIRED',resolutions=[dict(id='R1',status='UNRESOLVED',evidence='Bug remains.')])
            self.assertEqual(result['repair_round'],count)
            base = candidate
        self.f.git('commit','--allow-empty','-qm','attempt 3')
        with self.assertRaisesRegex(ValueError,'repair limit'):
            self.gate(mode='repair',base=base,candidate=self.f.git('rev-parse','HEAD'),previous=previous,
                      resolutions=[dict(id='R1',status='RESOLVED',evidence='Assertion now holds.')])

    def test_minor_ids_are_visible_without_report_relay(self):
        minor = self.defect(); minor['severity']='Minor'
        result,packet,_,_ = self.gate(findings=[minor])
        self.assertEqual(result['minor_ids'],['R1'])
        self.assertFalse(packet.exists())
        self.assertNotIn('Data loss.',json.dumps(result))

    def test_failed_required_verification_does_not_reach_review(self):
        report = self.f.build_report()
        report.write_text(report.read_text().replace('Verification-Status: PASS','Verification-Status: FAIL'))
        with self.assertRaisesRegex(ValueError,'must declare PASS'):
            vw.check_candidate(self.repo,self.f.base,self.f.candidate,report)

    def test_missing_required_verification_declaration_is_not_pass(self):
        report = self.f.build_report()
        report.write_text(report.read_text().replace('Verification-Status: PASS\n',''))
        with self.assertRaisesRegex(ValueError,'must declare PASS'):
            vw.check_candidate(self.repo,self.f.base,self.f.candidate,report)

    def final_contract(self):
        self.f.contract.write_text('<!-- dev-contract: ' + json.dumps(dict(schema=1,kind='final',base=self.f.base)) + ' -->\nIntegrated scope.\n')

    def test_final_review_requires_existing_validation(self):
        self.final_contract()
        with self.assertRaisesRegex(ValueError,'candidate-bound validation'):
            self.gate(mode='final')

    def test_stale_final_validation_cannot_approve(self):
        self.final_contract()
        report = self.f.build_report()
        report.write_text(report.read_text().replace(self.f.candidate,self.f.base))
        with self.assertRaisesRegex(ValueError,'Validation candidate'):
            self.gate(mode='final',validation=report)

    def test_matching_final_validation_is_allowed(self):
        self.final_contract()
        result,_,_,_ = self.gate(mode='final',validation=self.f.build_report())
        self.assertEqual(result['verdict'],'PASS')

    def test_final_contract_cannot_name_a_missing_validation_report(self):
        p=self.f.project();output=p/'work/final.md'
        result=self.f.cli('package_task.py','--plan',p/'plan.md','--spec',p/'spec.md',
                          '--progress',p/'progress.md','--final','--base',self.f.base,
                          '--report',p/'missing.md','--output',output)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(output.exists())

    def test_recovery_rejects_impossible_repair_count(self):
        p=self.f.project();(p/'progress.md').write_text('## Tasks\n- 1: REPAIR [repairs=99/2]\n')
        with self.assertRaisesRegex(ValueError,'Invalid repair count'):
            vw.check_project(p,self.repo)

    def test_recovery_rejects_accepted_without_evidence(self):
        p=self.f.project();(p/'progress.md').write_text('## Tasks\n- 1: ACCEPTED [repairs=0/2]\n')
        with self.assertRaisesRegex(ValueError,'lacks candidate-bound evidence'):
            vw.check_project(p,self.repo)

    def test_recovery_accepts_exact_receipts_without_rebuilding(self):
        _,_,review,package=self.gate()
        p=self.f.project()
        (p/'progress.md').write_text(f'## Tasks\n- 1: ACCEPTED [candidate={self.f.candidate}; repairs=0/2; contract={self.f.contract}; review={review}; package={package}; previous=none]\n')
        self.assertEqual(vw.check_project(p,self.repo)['status'],'PASS')
        before=(self.repo/'source').read_bytes()
        self.assertEqual(before,b'candidate\n')

    def test_untracked_snapshot_detects_new_and_changed_inputs(self):
        baseline=self.repo/'baseline.json'
        baseline.write_text(json.dumps({'repo':str(self.repo.resolve()),'files':vw.untracked_snapshot(self.repo,[baseline])}))
        vw.check_untracked(self.repo,baseline)
        new=self.repo/'hidden-source.rs';new.write_text('missing from commit')
        with self.assertRaisesRegex(ValueError,'untracked inputs'):
            vw.check_untracked(self.repo,baseline)
        new.unlink()
        self.f.contract.write_text('modified untracked dependency')
        with self.assertRaisesRegex(ValueError,'untracked inputs'):
            vw.check_untracked(self.repo,baseline)

    def test_untracked_snapshot_accepts_an_input_that_was_committed(self):
        baseline=self.repo/'baseline.json'
        baseline.write_text(json.dumps({'repo':str(self.repo.resolve()),'files':vw.untracked_snapshot(self.repo,[baseline])}))
        self.f.git('add','brief.md');self.f.git('commit','-qm','include input')
        vw.check_untracked(self.repo,baseline)


if __name__ == '__main__':
    unittest.main()
