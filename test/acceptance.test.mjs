import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBudgets,LIMITS,TOOL_ID} from '../src/index.mjs';

const budget=()=>({schemaVersion:'1',complete:true,routes:[{route:'/home',minRuns:3,metrics:[{audit:'largest-contentful-paint',aggregation:'median',max:2500,baseline:2000,tolerancePercent:10}]}]});
const capture=(values=[1900,2100,2300])=>({schemaVersion:'1',complete:true,runs:values.map((value,i)=>({route:'/home',runId:`r${i}`,report:{lighthouseVersion:'12.0.0',audits:{'largest-contentful-paint':{numericValue:value}}}}))});

test('all repeated Lighthouse runs yield a passing median with a measured count',()=>{
  const r=evaluateBudgets(budget(),capture(),{now:()=>0});assert.equal(TOOL_ID,'web-performance-budget-gate');
  assert.equal(r.status,'pass');assert.equal(r.summary.checked,1);assert.equal(r.summary.runsEvaluated,3);assert.deepEqual(r.findings,[]);
});
test('median regression beyond tolerance fails even if absolute max passes',()=>{
  const r=evaluateBudgets(budget(),capture([2100,2300,2400]),{now:()=>0});
  assert.equal(r.status,'fail');assert.deepEqual(r.findings.map(f=>f.ruleId),['regression-exceeded']);
});
test('named max aggregation includes every run, including the slow one',()=>{
  const b=budget();b.routes[0].metrics[0].aggregation='max';b.routes[0].metrics[0].baseline=4000;
  const r=evaluateBudgets(b,capture([1800,1900,3000]),{now:()=>0});
  assert.equal(r.status,'fail');assert.equal(r.findings[0].ruleId,'budget-exceeded');assert.equal(r.summary.runsEvaluated,3);
});
test('missing metric in one repeat is incomplete rather than cherry-picked',()=>{
  const c=capture();delete c.runs[1].report.audits['largest-contentful-paint'];
  const r=evaluateBudgets(budget(),c,{now:()=>0});assert.equal(r.status,'incomplete');assert.equal(r.findings[0].ruleId,'metric-unavailable');
  assert.equal(r.findings[0].location.pointer,'/runs/1/report/audits');
});
test('partial exports and too few repeats never pass',()=>{
  const c=capture();delete c.complete;assert.equal(evaluateBudgets(budget(),c,{now:()=>0}).status,'incomplete');
  const b=budget();delete b.complete;assert.equal(evaluateBudgets(b,capture(),{now:()=>0}).status,'incomplete');
  assert.equal(evaluateBudgets(budget(),capture([1900,2000]),{now:()=>0}).findings[0].ruleId,'runs-missing');
});
test('duplicate run identity and missing route are incomplete',()=>{
  const c=capture();c.runs[1].runId='r0';assert.equal(evaluateBudgets(budget(),c,{now:()=>0}).findings[0].ruleId,'run-duplicate');
  const d=capture();d.runs=[];assert.equal(evaluateBudgets(budget(),d,{now:()=>0}).status,'incomplete');
});
test('route, metric, run, depth, and clock bounds accept N and reject N+1',()=>{
  const b=budget(),c=capture();b.routes=Array.from({length:LIMITS.routes},(_,i)=>({route:`/r${i}`,minRuns:1,metrics:[{audit:'largest-contentful-paint',aggregation:'median',max:2500,baseline:2000,tolerancePercent:10}]}));c.runs=b.routes.map((x,i)=>({...capture([2000]).runs[0],route:x.route,runId:`run${i}`}));
  assert.equal(evaluateBudgets(b,c,{now:()=>0}).status,'pass');b.routes.push({route:'/extra',minRuns:1,metrics:b.routes[0].metrics});assert.equal(evaluateBudgets(b,c,{now:()=>0}).findings[0].ruleId,'record-limit');
  const d=budget(),e=capture();let x=d;for(let i=0;i<LIMITS.depth;i++){x.extra={};x=x.extra;}assert.equal(evaluateBudgets(d,e,{now:()=>0}).status,'pass');x.extra={};assert.equal(evaluateBudgets(d,e,{now:()=>0}).findings[0].ruleId,'depth-limit');
  const clock=n=>{let first=true;return()=>{if(first){first=false;return 0;}return n;};};assert.equal(evaluateBudgets(budget(),capture(),{now:clock(5000)}).status,'pass');assert.equal(evaluateBudgets(budget(),capture(),{now:clock(5001)}).findings[0].ruleId,'time-limit');
});
test('metric and run count accept N and reject N+1',()=>{
  const b=budget(),c=capture();b.routes[0].metrics=Array.from({length:LIMITS.metrics},(_,i)=>({audit:`metric-${i}`,aggregation:'max',max:2500,baseline:2000,tolerancePercent:25}));
  for(const run of c.runs)run.report.audits=Object.fromEntries(b.routes[0].metrics.map(x=>[x.audit,{numericValue:2000}]));
  assert.equal(evaluateBudgets(b,c,{now:()=>0}).status,'pass');
  b.routes[0].metrics.push({audit:'metric-extra',aggregation:'max',max:2500,baseline:2000,tolerancePercent:25});
  assert.equal(evaluateBudgets(b,c,{now:()=>0}).findings[0].ruleId,'record-limit');
  const d=budget(),e=capture(Array.from({length:LIMITS.runs},()=>2000));d.routes[0].minRuns=LIMITS.runs;
  assert.equal(evaluateBudgets(d,e,{now:()=>0}).status,'pass');
  e.runs.push({...e.runs[0],runId:'extra'});assert.equal(evaluateBudgets(d,e,{now:()=>0}).findings[0].ruleId,'record-limit');
});
test('capture depth boundary and named mean aggregation are evaluated',()=>{
  const b=budget(),c=capture([1800,2200,2300]);b.routes[0].metrics[0].aggregation='mean';
  let x=c;for(let i=0;i<LIMITS.depth;i++){x.extra={};x=x.extra;}
  assert.equal(evaluateBudgets(b,c,{now:()=>0}).status,'pass');x.extra={};assert.equal(evaluateBudgets(b,c,{now:()=>0}).findings[0].ruleId,'depth-limit');
  const r=evaluateBudgets(b,capture([2100,2300,2500]),{now:()=>0});assert.equal(r.status,'fail');assert.equal(r.findings[0].ruleId,'regression-exceeded');
});
test('duplicate budget metrics and routes cannot produce a clean check',()=>{
  const b=budget();b.routes[0].metrics.push({...b.routes[0].metrics[0]});assert.equal(evaluateBudgets(b,capture(),{now:()=>0}).findings[0].ruleId,'metric-duplicate');
  const d=budget();d.routes.push(structuredClone(d.routes[0]));assert.equal(evaluateBudgets(d,capture(),{now:()=>0}).findings[0].ruleId,'route-duplicate');
});
test('finding pointers sort by code unit rather than numeric route ordinal',()=>{
  const b=budget();b.routes=Array.from({length:11},(_,i)=>({route:`/r${i}`,minRuns:1,metrics:[{audit:'largest-contentful-paint',aggregation:'max',max:i===2||i===10?1000:2500,baseline:2000,tolerancePercent:10}]}));
  const c=capture();c.runs=b.routes.map((x,i)=>({route:x.route,runId:`r${i}`,report:{lighthouseVersion:'12.0.0',audits:{'largest-contentful-paint':{numericValue:2000}}}}));
  const r=evaluateBudgets(b,c,{now:()=>0});assert.equal(r.status,'fail');assert.deepEqual(r.findings.map(f=>f.location.pointer),['/routes/10/metrics/0','/routes/2/metrics/0']);
});
test('exact decimal mean and even median at a budget boundary pass without epsilon masking',()=>{
  for(const aggregation of ['mean','median']){
    const b=budget();b.routes[0]={route:'/',minRuns:2,metrics:[{audit:'foo',aggregation,max:0.15,baseline:0.15,tolerancePercent:0}]};
    const c={schemaVersion:'1',complete:true,runs:[0.1,0.2].map((numericValue,i)=>({route:'/',runId:`r${i}`,report:{lighthouseVersion:'12.0.0',audits:{foo:{numericValue}}}}))};
    assert.equal(evaluateBudgets(b,c,{now:()=>0}).status,'pass');
    c.runs[1].report.audits.foo.numericValue=0.20000000000000004;
    const over=evaluateBudgets(b,c,{now:()=>0});assert.equal(over.status,'fail');assert.deepEqual(over.findings.map(f=>f.ruleId),['budget-exceeded','regression-exceeded']);
  }
});
