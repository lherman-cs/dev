import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {encode,decode} from '@toon-format/toon';
import {runWorkflow} from '../lib/workflow.mjs';

const pass=()=>({verdict:'pass',summary:'No material issue',review_focus:['Compatibility'],validation:['Local gates'],repairs:[]});
const issue=(key='test.root')=>({key,title:'Correct behavior',goal:'Keep approved behavior',reason:'Concrete defect',evidence:['file:line'],requirements:['Preserve interface'],checks:['test -f done']});
function fixture(t) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'shipping-test-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const root=path.join(home,'repo'),remote=path.join(home,'remote.git');fs.mkdirSync(root);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q','-b','feature');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  fs.writeFileSync(path.join(root,'seed'),'seed');git('add','seed');git('commit','-qm','test: seed');
  const base=git('rev-parse','HEAD');execFileSync('git',['init','--bare','-q',remote]);git('remote','add','origin',remote);git('push','origin','HEAD:main');git('fetch','origin','main');
  const dir=path.join(root,'plans','project');fs.mkdirSync(path.join(dir,'plans'),{recursive:true});
  const write=(file,value)=>fs.writeFileSync(path.join(dir,file),encode(value)+'\n');
  const read=file=>decode(fs.readFileSync(path.join(dir,file),'utf8'));
  fs.writeFileSync(path.join(dir,'spec.md'),'Status: APPROVED\n');
  write('project.toon',{status:'ready',base,final_checks:['test -f done']});
  write('plans/P001.toon',{id:'P001',title:'task',goal:'do',depends_on:[],checks:['test -f done']});
  const pr={id:'PR_test',number:1,url:'https://example.invalid/pr/1',state:'OPEN',isDraft:true,headRefOid:base,baseRefOid:base,baseRefName:'main'};
  const api=[],delegations=[],decisions=[],reports=[];let clock=1,exists=false,red=false;
  const h={cwd:root,now:()=>clock,sleep:async ms=>{clock+=ms;},report:message=>reports.push(message),confirm:async()=>true,select:async()=>undefined,
    review:async (...args)=>{decisions.push(args);return {action:'approve'};},
    async exec(program,args){
      if(program==='gh') {
        api.push(args);
        if(args[0]==='api') return {code:0,stdout:JSON.stringify({data:{node:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}),stderr:''};
        if(args[1]==='list') return {code:0,stdout:JSON.stringify(exists?[pr]:[]),stderr:''};
        if(args[1]==='create') exists=true;
        if(args[1]==='ready') pr.isDraft=args.includes('--undo');
        if(args[1]==='view') {pr.headRefOid=git('rev-parse','HEAD');return {code:0,stdout:JSON.stringify({...pr,updatedAt:'fixed',comments:[],reviews:[],statusCheckRollup:[{__typename:'CheckRun',status:'COMPLETED',conclusion:red?'FAILURE':'SUCCESS'}]}),stderr:''};}
        return {code:0,stdout:'ok',stderr:''};
      }
      try {return {code:0,stdout:execFileSync(program,args,{cwd:this.cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}),stderr:''};}
      catch(error){return {code:error.status||-1,stdout:error.stdout||'',stderr:error.stderr||''};}
    },
    async delegate(name,task){
      delegations.push(name);
      if(name==='build'||name==='build_retry') {
        const contract=/Execution contract: (.*)/.exec(task)?.[1];
        fs.writeFileSync(path.join(root,'done'),contract||'done');git('add','done');git('commit','-qm','feat: implement outcome');return 'done';
      }
      if(name==='review') return pass();
      if(name==='ship') return {title:'feat: implement outcome',body:'Summary and validation'};
      assert.fail(`Unexpected delegated phase ${name}`);
    }};
  return {h,dir,root,base,git,write,read,pr,api,delegations,decisions,reports,setRed:value=>red=value};
}
test('ship sequences preparation in code, settles feedback, approves exact HEAD and never merges',async t=>{
  const f=fixture(t);await runWorkflow(f.h,'ship',f.dir);
  assert.deepEqual(f.delegations,['build','review','ship']);assert.equal(f.decisions.length,1);
  const state=f.read('ship.toon');assert.equal(state.phase,'done');assert.equal(state.approved_head,f.git('rev-parse','HEAD'));
  assert.ok(f.reports.some(message=>message.startsWith('Building P001: task')));
  assert.ok(f.reports.includes('Preparation: fetching and rebasing onto origin/main.'));
  assert.ok(f.reports.includes('Preparation: running 1 final validation check.'));
  assert.ok(f.reports.includes('Validating: test -f done'));
  assert.ok(f.reports.some(message=>message.startsWith('Preparation: publishing verified candidate ')));
  assert.ok(f.reports.includes('Signals are complete. Starting the 60-second quiet period.'));
  assert.ok(f.reports.includes('PR #1 signals settled. Starting independent review.'));
  assert.equal(f.pr.isDraft,false);assert.ok(!f.api.some(a=>a[1]==='merge'));
});
test('finalizer interruption preserves exact-HEAD approval and resume does not repeat human gate',async t=>{
  const f=fixture(t),delegate=f.h.delegate;let fail=true;
  f.h.delegate=async (...args)=>{if(args[0]==='ship'&&fail){fail=false;throw new Error('transport failed');}return delegate(...args);};
  await assert.rejects(runWorkflow(f.h,'ship',f.dir),/transport failed/);
  assert.equal(f.read('ship.toon').approved_head,f.git('rev-parse','HEAD'));
  await runWorkflow(f.h,'ship',f.dir);assert.equal(f.decisions.length,1);assert.equal(f.read('ship.toon').phase,'done');
});
test('red terminal CI remains review evidence but a false PASS never reaches human approval',async t=>{
  const f=fixture(t);f.setRed(true);
  await assert.rejects(runWorkflow(f.h,'ship',f.dir),/CI is red/);
  assert.equal(f.decisions.length,0);assert.equal(f.pr.isDraft,true);
});
test('human feedback is sent to Reviewer and cannot silently pass',async t=>{
  const f=fixture(t),delegate=f.h.delegate;let feedbackSeen=false;
  f.h.review=async()=>({action:'feedback',feedback:'Correct missing behavior'});
  f.h.delegate=async (name,task,...rest)=>{if(name==='review'&&task.includes('Human feedback:')) feedbackSeen=true;return delegate(name,task,...rest);};
  await assert.rejects(runWorkflow(f.h,'ship',f.dir),/feedback may not be silently passed/);assert.ok(feedbackSeen);assert.ok(f.pr.isDraft);
});
test('repairs retain stable source.finding_key and repeated findings stop the loop',async t=>{
  const f=fixture(t),delegate=f.h.delegate;
  f.h.delegate=async (name,...args)=>name==='review'?{...pass(),verdict:'repairs',repairs:[issue()]}:delegate(name,...args);
  await assert.rejects(runWorkflow(f.h,'ship',f.dir),/recurring finding/);
  assert.equal(f.read('repairs/R001.toon').source.finding_key,'test.root');
  assert.deepEqual(f.read('repairs/R001.toon').requirements,['Preserve interface']);
  assert.equal(f.read('ship.toon').phase,'blocked');
});
test('manual review applies only human-selected concrete repairs',async t=>{
  const f=fixture(t),delegate=f.h.delegate;
  await runWorkflow(f.h,'build',f.dir);await runWorkflow(f.h,'prepare',f.dir);
  f.h.delegate=async name=>name==='review'?{...pass(),verdict:'repairs',repairs:[issue('a'),issue('b')]}:assert.fail(name);
  f.h.review=async()=>({action:'repairs',keys:['b']});
  await runWorkflow(f.h,'review',f.dir);
  assert.equal(f.read('repairs/R001.toon').source.finding_key,'b');assert.ok(!fs.existsSync(path.join(f.dir,'repairs/R002.toon')));
});
test('final gate failure becomes one narrow repair in ship, not a Preparer model patch',async t=>{
  const f=fixture(t),delegate=f.h.delegate;
  f.write('project.toon',{status:'ready',base:f.base,final_checks:['test -f fixed']});
  f.h.delegate=async (name,task,...args)=>{
    if((name==='build'||name==='build_retry')&&task.includes('/repairs/')) {
      fs.writeFileSync(path.join(f.root,'fixed'),'fixed');f.git('add','fixed');f.git('commit','-qm','fix: final integration gate');return 'done';
    }
    return delegate(name,task,...args);
  };
  await runWorkflow(f.h,'ship',f.dir);
  assert.match(f.read('repairs/R001.toon').source.finding_key,/^final-gate:/);assert.equal(f.read('ship.toon').repair_round,1);
});
test('quiet period resets when late review feedback arrives; waiting uses no worker',async t=>{
  const f=fixture(t),execute=f.h.exec.bind(f.h),sleep=f.h.sleep,delegate=f.h.delegate;let late=false,sleeps=0;
  f.h.sleep=async ms=>{assert.deepEqual(f.delegations,['build']);await sleep(ms);if(++sleeps===3)late=true;};
  f.h.exec=async (program,args)=>{
    const result=await execute(program,args);
    if(program==='gh'&&args[1]==='view') {const data=JSON.parse(result.stdout);data.comments=late?[{body:'Late bot feedback'}]:[];result.stdout=JSON.stringify(data);}
    return result;
  };
  f.h.delegate=async (name,...args)=>{if(name==='review')assert.ok(f.h.now()>=90001);return delegate(name,...args);};
  await runWorkflow(f.h,'ship',f.dir);assert.equal(f.read('ship.toon').phase,'done');
  assert.ok(f.reports.includes('New feedback detected. Restarting the 60-second quiet period.'));
});
test('pending repair batch is replayed idempotently after partial checkpoint publication',async t=>{
  const f=fixture(t);await runWorkflow(f.h,'build',f.dir);
  fs.mkdirSync(path.join(f.dir,'repairs'));
  const head=f.git('rev-parse','HEAD'),repair=issue('resume.root');
  f.write('repairs/R001.toon',{id:'R001',...repair,depends_on:['P001'],source:{finding_key:repair.key,candidate:head}});
  f.write('ship.toon',{version:1,phase:'review',repair_round:0,pending_repairs:{issues:[repair],candidate:{head}}});
  await runWorkflow(f.h,'ship',f.dir);
  assert.deepEqual(fs.readdirSync(path.join(f.dir,'repairs')),['R001.toon']);
  assert.equal(f.read('ship.toon').repair_round,1);assert.equal(f.read('ship.toon').phase,'done');
});
test('base moved after approval cannot be marked ready',async t=>{
  const f=fixture(t);
  f.h.review=async()=>{f.pr.baseRefOid='0'.repeat(40);return {action:'approve'};};
  await assert.rejects(runWorkflow(f.h,'ship',f.dir),/Candidate or base changed/);
  assert.equal(f.pr.isDraft,true);assert.ok(!f.api.some(a=>a[1]==='ready'&&!a.includes('--undo')));
});
test('standalone Prepare reports a final gate failure without inventing repairs',async t=>{
  const f=fixture(t);await runWorkflow(f.h,'build',f.dir);
  f.write('project.toon',{status:'ready',base:f.base,final_checks:['test -f missing']});
  await assert.rejects(runWorkflow(f.h,'prepare',f.dir),/Final gate failed/);
  assert.ok(!fs.existsSync(path.join(f.dir,'repairs')));assert.deepEqual(f.delegations,['build']);
});
test('default final gates run just check and just test before publication',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'Justfile'),'check:\n    true\ntest:\n    true\n');f.git('add','Justfile');f.git('commit','-qm','test: repository gates');
  f.write('project.toon',{status:'ready',base:f.git('rev-parse','HEAD'),final_checks:[]});
  const execute=f.h.exec.bind(f.h),gates=[];
  f.h.exec=async (program,args)=>{if(program==='bash'&&args[1].startsWith('just ')){gates.push(args[1]);return {code:0,stdout:'ok',stderr:''};}return execute(program,args);};
  await runWorkflow(f.h,'ship',f.dir);assert.deepEqual(gates,['just check','just test']);
});

test('Prepare resumes a real interrupted rebase with a narrowly scoped conflict worker',async t=>{
  const f=fixture(t);await runWorkflow(f.h,'build',f.dir);
  fs.writeFileSync(path.join(f.root,'seed'),'feature change');f.git('add','seed');f.git('commit','-qm','feat: preserve feature intent');
  const progress=f.read('progress.toon');progress.head=f.git('rev-parse','HEAD');f.write('progress.toon',progress);
  f.git('checkout','-b','upstream',f.base);
  fs.writeFileSync(path.join(f.root,'seed'),'upstream change');f.git('add','seed');f.git('commit','-qm','fix: upstream change');
  f.git('push','origin','HEAD:main');f.git('fetch','origin','main');f.git('checkout','feature');
  assert.throws(()=>f.git('rebase','origin/main'));
  assert.equal(f.git('branch','--show-current'),'');
  f.pr.baseRefOid=f.git('rev-parse','origin/main');
  f.h.delegate=async (name,task,_skill,_schema,options)=>{
    assert.equal(name,'build_retry');assert.match(task,/Conflicted files:\nseed/);
    assert.ok(!options.tools.includes('bash'));
    fs.writeFileSync(path.join(f.root,'seed'),'both approved changes');return 'Resolved';
  };
  await runWorkflow(f.h,'prepare',f.dir);
  assert.equal(f.git('branch','--show-current'),'feature');
  assert.equal(f.git('status','--porcelain'),'');
  assert.equal(f.read('ship.toon').phase,'await');assert.ok(f.pr.isDraft);
});

test('manual repair selection refuses evidence that changed during the human decision',async t=>{
  const f=fixture(t);await runWorkflow(f.h,'build',f.dir);await runWorkflow(f.h,'prepare',f.dir);
  f.h.delegate=async()=>({...pass(),verdict:'repairs',repairs:[issue()]});
  f.h.review=async()=>{f.pr.baseRefOid='0'.repeat(40);return {action:'repairs',keys:['test.root']};};
  await assert.rejects(runWorkflow(f.h,'review',f.dir),/Candidate or base changed/);
  assert.ok(!fs.existsSync(path.join(f.dir,'repairs')));
});

test('pause during agentless CI polling preserves candidate and stops before reviewer dispatch',async t=>{
  const {WorkflowControl,WorkflowPaused}=await import('../lib/workflow-control.mjs');
  const f=fixture(t),c=new WorkflowControl('ship',f.dir),sleep=f.h.sleep;
  f.h.checkpoint=activity=>c.checkpoint(activity);f.h.sleep=async ms=>{await sleep(ms);c.pause();};
  await assert.rejects(runWorkflow(f.h,'ship',f.dir),WorkflowPaused);
  assert.deepEqual(f.delegations,['build']);assert.equal(f.read('ship.toon').phase,'await');assert.ok(f.read('ship.toon').candidate.head);
  delete f.h.checkpoint;f.h.sleep=sleep;await runWorkflow(f.h,'ship',f.dir);
  assert.equal(f.read('ship.toon').phase,'done');assert.deepEqual(f.delegations,['build','review','ship']);
});
