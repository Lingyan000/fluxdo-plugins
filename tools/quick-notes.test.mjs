import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../plugins/quick-notes/main.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function setup({get=async()=>'',set=async()=>{},confirm=async()=>true}={}){
  const events=new Map(),data={},writes=[],toasts=[];
  const api={host:{environment:async()=>({locale:'zh'})},storage:{get,set:async(_,value)=>{writes.push(value);await set(value);}},dialogs:{confirm},toast:async text=>toasts.push(text)};
  const ctx={surface:'card',api,setData:(k,v)=>data[k]=v};
  vm.runInNewContext(script,{fluxdo:{on:(n,f)=>events.set(n,f)}});
  return{data,writes,toasts,fire:(name,args={})=>events.get(name)(ctx,args)};
}
test('迟到读取不覆盖草稿，连续输入只串行写最新内容',async()=>{
  const read=deferred(),first=deferred();let active=0,max=0;
  const t=setup({get:()=>read.promise,set:async()=>{max=Math.max(max,++active);if(t.writes.length===1)await first.promise;active--;}});
  const load=t.fire('card.load');await new Promise(r=>setImmediate(r));
  const a=t.fire('save',{value:'草稿一'});read.resolve('旧内容');await load;await new Promise(r=>setImmediate(r));
  const b=t.fire('save',{value:'草稿二'}),c=t.fire('save',{value:'草稿三'});
  await new Promise(r=>setImmediate(r));assert.equal(t.data.note,'草稿三');first.resolve();await Promise.all([a,b,c]);
  assert.deepEqual(t.writes,['草稿一','草稿三']);assert.equal(max,1);assert.equal(t.data.status,'已自动保存');
});
test('保存失败保留草稿，显式重试后才显示保存成功',async()=>{
  let failed=true;const t=setup({set:async()=>{if(failed)throw Error('disk');}});await t.fire('card.load');
  await t.fire('save',{value:'保留内容'});assert.equal(t.data.note,'保留内容');assert.equal(t.data.failed,true);
  failed=false;await t.fire('retry');assert.equal(t.data.failed,false);assert.equal(t.data.status,'已自动保存');
});
test('清空必须确认，确认期间新编辑不会被清掉',async()=>{
  const choice=deferred();const t=setup({get:async()=>'原便笺',confirm:()=>choice.promise});await t.fire('card.load');
  const clear=t.fire('clear');await new Promise(r=>setImmediate(r));await t.fire('save',{value:'刚刚编辑'});
  choice.resolve(true);await clear;assert.equal(t.data.note,'刚刚编辑');assert.equal(t.toasts.length,1);assert.ok(!t.writes.includes(''));
});
test('读取失败可重试且不空写，取消清空不改数据',async()=>{
  let fail=true;const t=setup({get:async()=>{if(fail)throw Error('disk');return'已有内容';},confirm:async()=>false});
  await t.fire('card.load');assert.equal(t.data.failed,true);assert.equal(t.writes.length,0);
  fail=false;await t.fire('retry');assert.equal(t.data.note,'已有内容');await t.fire('clear');assert.equal(t.writes.length,0);
  await t.fire('surface.close');await t.fire('save',{value:'后台收尾'});assert.equal(t.data.note,'已有内容');assert.equal(t.writes.at(-1),'后台收尾');
});
