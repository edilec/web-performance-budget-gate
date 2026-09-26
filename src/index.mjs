export const TOOL_ID='web-performance-budget-gate';
export const LIMITS=Object.freeze({budgetBytes:262144,captureBytes:1048576,routes:100,metrics:20,runs:1000,depth:16,milliseconds:5000});
export const RULE_SEVERITY=Object.freeze({'input-unreadable':'warning','input-invalid':'warning','export-incomplete':'warning','byte-limit':'warning','record-limit':'warning','depth-limit':'warning','time-limit':'warning','route-duplicate':'warning','metric-duplicate':'warning','run-duplicate':'warning','runs-missing':'warning','metric-unavailable':'warning','budget-exceeded':'error','regression-exceeded':'error'});
const MESSAGES=Object.freeze({'input-unreadable':'Input could not be read, decoded, or parsed.','input-invalid':'Budget or capture document has unsupported or invalid fields.','export-incomplete':'Capture or budget does not assert complete coverage.','byte-limit':'Input exceeds its declared byte limit.','record-limit':'Route, metric, or run count exceeds a declared limit.','depth-limit':'JSON nesting exceeds depth 16.','time-limit':'Evaluation exceeded 5000 milliseconds.','route-duplicate':'Budget route identity is duplicated.','metric-duplicate':'Metric identity is duplicated within a route.','run-duplicate':'Captured run identity is duplicated for a route.','runs-missing':'Fewer captured runs than the declared minimum.','metric-unavailable':'A named metric is missing or unusable in a captured run.','budget-exceeded':'Aggregated metric exceeds its absolute budget.','regression-exceeded':'Aggregated metric exceeds its baseline tolerance.'});
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safe=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\p{Cf}]/u.test(x);
const route=x=>safe(x)&&x.startsWith('/')&&!x.startsWith('//')&&!/[?#\\]/.test(x);
const audit=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(x);
const runId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const value=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1_000_000_000;
function finding(ruleId,file,pointer=''){if(!Object.hasOwn(RULE_SEVERITY,ruleId))throw Error('unknown rule');return {ruleId,severity:RULE_SEVERITY[ruleId],message:MESSAGES[ruleId],location:{file,pointer}};}
function report(findings,checked=0,runsEvaluated=0){findings.sort((a,b)=>cmp(a.location.file,b.location.file)||cmp(a.location.pointer,b.location.pointer)||cmp(a.ruleId,b.ruleId));const status=findings.some(f=>f.severity==='warning')?'incomplete':findings.length?'fail':'pass';return {schemaVersion:'1',tool:TOOL_ID,status,summary:{checked,runsEvaluated,errors:findings.filter(f=>f.severity==='error').length,warnings:findings.filter(f=>f.severity==='warning').length},findings};}
export function incomplete(ruleId,file){return report([finding(ruleId,file)]);}
function tooDeep(input){const stack=[[input,0]];while(stack.length){const [item,depth]=stack.pop();if(depth>LIMITS.depth)return true;if(item&&typeof item==='object')for(const child of Object.values(item))stack.push([child,depth+1]);}return false;}
function validMetric(x){return object(x)&&audit(x.audit)&&['median','mean','max'].includes(x.aggregation)&&value(x.max)&&value(x.baseline)&&value(x.tolerancePercent)&&x.tolerancePercent<=100;}
function validBudget(x){return object(x)&&x.schemaVersion==='1'&&(x.complete===undefined||typeof x.complete==='boolean')&&Array.isArray(x.routes)&&x.routes.length>0;}
function validCapture(x){return object(x)&&x.schemaVersion==='1'&&(x.complete===undefined||typeof x.complete==='boolean')&&Array.isArray(x.runs);}
const power=n=>10n**BigInt(n);
function decimal(number){
  const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(number.toString());
  const fraction=match[2]||'',exponent=Number(match[3]||0);
  let numerator=BigInt(match[1]+fraction),scale=fraction.length-exponent;
  if(scale<0){numerator*=power(-scale);scale=0;}
  return {numerator,scale};
}
function aggregateRatio(values,method){
  const decimals=values.map(decimal),scale=Math.max(...decimals.map(x=>x.scale));
  const units=decimals.map(x=>x.numerator*power(scale-x.scale));
  if(method==='mean')return {numerator:units.reduce((a,b)=>a+b,0n),denominator:BigInt(units.length)*power(scale)};
  units.sort((a,b)=>a<b?-1:a>b?1:0);
  if(method==='max')return {numerator:units.at(-1),denominator:power(scale)};
  const mid=Math.floor(units.length/2);
  return units.length%2?{numerator:units[mid],denominator:power(scale)}:{numerator:units[mid-1]+units[mid],denominator:2n*power(scale)};
}
function baselineRatio(baseline,tolerancePercent){
  const b=decimal(baseline),t=decimal(tolerancePercent);
  return {numerator:b.numerator*(100n*power(t.scale)+t.numerator),denominator:100n*power(b.scale+t.scale)};
}
const exceeds=(actual,limit)=>actual.numerator*limit.denominator>limit.numerator*actual.denominator;

export function evaluateBudgets(budget,capture,{now=()=>performance.now()}={}){
  const start=now(),findings=[];const timed=()=>now()-start>LIMITS.milliseconds;
  if(tooDeep(budget))findings.push(finding('depth-limit','@budget'));
  if(tooDeep(capture))findings.push(finding('depth-limit','@capture'));
  if(findings.length)return report(findings);
  if(!validBudget(budget))findings.push(finding('input-invalid','@budget'));
  if(!validCapture(capture))findings.push(finding('input-invalid','@capture'));
  if(findings.length)return report(findings);
  if(budget.complete!==true)findings.push(finding('export-incomplete','@budget','/complete'));
  if(capture.complete!==true)findings.push(finding('export-incomplete','@capture','/complete'));
  if(findings.length)return report(findings);
  if(budget.routes.length>LIMITS.routes)findings.push(finding('record-limit','@budget','/routes'));
  if(capture.runs.length>LIMITS.runs)findings.push(finding('record-limit','@capture','/runs'));
  if(findings.length)return report(findings);
  const routeIndex=new Map();
  for(const [i,item] of budget.routes.entries()){
    if(timed())return incomplete('time-limit','@budget');
    if(!object(item)||!route(item.route)||!Number.isInteger(item.minRuns)||item.minRuns<1||item.minRuns>LIMITS.runs||!Array.isArray(item.metrics)||item.metrics.length===0){findings.push(finding('input-invalid','@budget',`/routes/${i}`));continue;}
    if(item.metrics.length>LIMITS.metrics){findings.push(finding('record-limit','@budget',`/routes/${i}/metrics`));continue;}
    if(routeIndex.has(item.route)){findings.push(finding('route-duplicate','@budget',`/routes/${i}`));continue;}
    routeIndex.set(item.route,{item,i});
    const seen=new Set();
    for(const [j,metric] of item.metrics.entries()){
      if(!validMetric(metric)){findings.push(finding('input-invalid','@budget',`/routes/${i}/metrics/${j}`));continue;}
      if(seen.has(metric.audit))findings.push(finding('metric-duplicate','@budget',`/routes/${i}/metrics/${j}`));
      seen.add(metric.audit);
    }
  }
  if(findings.length)return report(findings);
  const runs=new Map(),seenRuns=new Set();
  for(const [i,entry] of capture.runs.entries()){
    if(timed())return incomplete('time-limit','@capture');
    if(!object(entry)||!route(entry.route)||!runId(entry.runId)||!object(entry.report)||!safe(entry.report.lighthouseVersion)||!object(entry.report.audits)){
      findings.push(finding('input-invalid','@capture',`/runs/${i}`));continue;
    }
    const key=`${entry.route}\u0000${entry.runId}`;
    if(seenRuns.has(key)){findings.push(finding('run-duplicate','@capture',`/runs/${i}`));continue;}
    seenRuns.add(key);
    if(!runs.has(entry.route))runs.set(entry.route,[]);
    runs.get(entry.route).push({entry,i});
  }
  if(findings.length)return report(findings);
  let checked=0,runsEvaluated=0;
  for(const {item,i} of routeIndex.values()){
    if(timed())return incomplete('time-limit','@budget');
    const grouped=runs.get(item.route)||[];
    runsEvaluated+=grouped.length;
    if(grouped.length<item.minRuns){findings.push(finding('runs-missing','@budget',`/routes/${i}/minRuns`));continue;}
    for(const [j,metric] of item.metrics.entries()){
      const values=[];let missing=false;
      for(const {entry,i:ordinal} of grouped){
        if(timed())return incomplete('time-limit','@capture');
        const observed=entry.report.audits[metric.audit];
        if(!object(observed)||!value(observed.numericValue)){findings.push(finding('metric-unavailable','@capture',`/runs/${ordinal}/report/audits`));missing=true;}
        else values.push(observed.numericValue);
      }
      if(missing)continue;
      checked++;
      const result=aggregateRatio(values,metric.aggregation),absolute=decimal(metric.max),pointer=`/routes/${i}/metrics/${j}`;
      if(exceeds(result,{numerator:absolute.numerator,denominator:power(absolute.scale)}))findings.push(finding('budget-exceeded','@budget',pointer));
      if(exceeds(result,baselineRatio(metric.baseline,metric.tolerancePercent)))findings.push(finding('regression-exceeded','@budget',pointer));
    }
  }
  if(timed())return incomplete('time-limit','@capture');
  return report(findings,checked,runsEvaluated);
}
