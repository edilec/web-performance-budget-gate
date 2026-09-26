import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const cli=new URL('../bin/web-performance-budget-gate.mjs',import.meta.url).pathname;
const budget={schemaVersion:'1',complete:true,routes:[{route:'/home',minRuns:3,metrics:[{audit:'largest-contentful-paint',aggregation:'median',max:2500,baseline:2000,tolerancePercent:10}]}]};
const capture={schemaVersion:'1',complete:true,runs:[1900,2100,2300].map((numericValue,i)=>({route:'/home',runId:`r${i}`,report:{lighthouseVersion:'12.0.0',audits:{'largest-contentful-paint':{numericValue}}}}))};
function fixture(run){const root=mkdtempSync(join(tmpdir(),'perf-budget-'));try{writeFileSync(join(root,'budget.json'),JSON.stringify(budget));writeFileSync(join(root,'capture.json'),JSON.stringify(capture));return run(root);}finally{rmSync(root,{recursive:true,force:true});}}
const invoke=root=>spawnSync(process.execPath,[cli,'--root',root,'--budget','budget.json','--capture','capture.json'],{encoding:'utf8'});

test('CLI deterministic good case and no raw metric values in report',()=>fixture(root=>{
  const a=invoke(root),b=invoke(root);assert.equal(a.status,0);assert.equal(a.stdout,b.stdout);assert.equal(JSON.parse(a.stdout).status,'pass');assert.doesNotMatch(a.stdout,/2300|largest-contentful-paint/);
}));
test('bad usage has empty stdout, unreadable input has incomplete report',()=>fixture(root=>{
  const bad=spawnSync(process.execPath,[cli,'--oops'],{encoding:'utf8'});assert.equal(bad.status,2);assert.equal(bad.stdout,'');
  const missing=spawnSync(process.execPath,[cli,'--root',root,'--budget','missing.json','--capture','capture.json'],{encoding:'utf8'});assert.equal(missing.status,2);assert.equal(JSON.parse(missing.stdout).findings[0].ruleId,'input-unreadable');
}));
test('budget bytes accept 262144 and reject 262145',()=>fixture(root=>{
  const base=JSON.stringify(budget),path=join(root,'budget.json');writeFileSync(path,base+' '.repeat(262144-Buffer.byteLength(base)));assert.equal(invoke(root).status,0);
  writeFileSync(path,base+' '.repeat(262145-Buffer.byteLength(base)));const r=invoke(root);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).findings[0].ruleId,'byte-limit');
}));
test('capture bytes accept 1048576 and reject 1048577',()=>fixture(root=>{
  const base=JSON.stringify(capture),path=join(root,'capture.json');writeFileSync(path,base+' '.repeat(1048576-Buffer.byteLength(base)));assert.equal(invoke(root).status,0);
  writeFileSync(path,base+' '.repeat(1048577-Buffer.byteLength(base)));const r=invoke(root);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).findings[0].ruleId,'byte-limit');
}));
test('escaping capture symlink is refused without reading outside data',()=>{
  const root=mkdtempSync(join(tmpdir(),'perf-root-')),outside=mkdtempSync(join(tmpdir(),'perf-out-'));
  try{writeFileSync(join(root,'budget.json'),JSON.stringify(budget));writeFileSync(join(outside,'private.json'),'PRIVATE_SENTINEL');symlinkSync(join(outside,'private.json'),join(root,'capture.json'));const r=invoke(root);assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).findings[0].ruleId,'input-unreadable');assert.doesNotMatch(r.stdout,/PRIVATE_SENTINEL/);}
  finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('ambiguous duplicate JSON keys cannot certify complete capture or config',()=>fixture(root=>{
  const c=JSON.stringify(capture).replace('"complete":true','"complete":false,"comple\\u0074e":true');
  writeFileSync(join(root,'capture.json'),c);
  const unknown=invoke(root);assert.equal(unknown.status,2);assert.equal(JSON.parse(unknown.stdout).status,'incomplete');
  writeFileSync(join(root,'capture.json'),JSON.stringify(capture));
  const b=JSON.stringify(budget).replace('"complete":true','"complete":false,"comple\\u0074e":true');
  writeFileSync(join(root,'budget.json'),b);
  const invalid=invoke(root);assert.equal(invalid.status,2);assert.equal(invalid.stdout,'');
}));
test('strict UTF-8 and parse failures stay incomplete without leaking payloads',()=>fixture(root=>{
  const head=JSON.stringify(capture).slice(0,-1)+',"extra":"';
  writeFileSync(join(root,'capture.json'),Buffer.concat([Buffer.from(head),Buffer.from([0xff]),Buffer.from('"}')]));
  const invalidUtf=invoke(root);assert.equal(invalidUtf.status,2);assert.equal(JSON.parse(invalidUtf.stdout).findings[0].ruleId,'input-unreadable');
  writeFileSync(join(root,'capture.json'),'PRIVATE_SENTINEL');const malformed=invoke(root);assert.equal(malformed.status,2);assert.equal(JSON.parse(malformed.stdout).findings[0].ruleId,'input-unreadable');assert.doesNotMatch(malformed.stdout+malformed.stderr,/PRIVATE_SENTINEL/);
}));
