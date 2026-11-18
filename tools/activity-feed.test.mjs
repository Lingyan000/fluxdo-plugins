import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../plugins/activity-feed/main.js',import.meta.url),'utf8');
function setup(){
  let stored=null,job=null,allowed=false,day=1,drop='',pause=null,accept=true;const events=new Map(),data={},opened=[],sent=[],people=[],asked=[],reads=[];
  const grants={identity:true,forumFollowing:true,forumProfiles:true,forumActivity:true,background:true,notifications:true};
  const api={on:(name,fn)=>events.set(name,fn),toast:async()=>{},navigate:async page=>opened.push({page}),user:{get:()=>({username:'owner'})},
    permissions:{status:async()=>({...grants}),request:async names=>{asked.push([...names]);if(accept)for(const p of names)grants[p]=true;return accept;}},
    storage:{get:async()=>structuredClone(stored),compareAndSet:async(k,expect,next)=>{if(!isDeepStrictEqual(stored,structuredClone(expect)))return false;stored=structuredClone(next);return true;}},
    tasks:{list:async()=>job?[job]:[],schedule:async v=>{job=v;return true;},cancel:async()=>{job=null;}},navigation:{setBadge:async()=>{}},
    notifications:{isAllowed:async()=>allowed,requestPermission:async()=>allowed=true,revoke:async()=>{allowed=false;},cancel:async()=>{},show:async v=>{sent.push(v);return true;}},
    forum:{open:async v=>opened.push(v),read:async({username,resource,offset})=>{
      reads.push(resource);if(resource==='following')return {items:people.slice(offset,offset+20).map(username=>({username})),nextOffset:offset+20<people.length?offset+20:null};
      if(resource==='user')return {id:1,username};if(username===drop)throw Error('forum_not_found');
      if(pause){const f=pause;pause=null;await f();}
      const types=resource==='actions'?['topics','replies','likes']:[resource];
      return {items:Array.from({length:day},(_,i)=>types.map(type=>({id:`${i}-${type}`,action:type,topicId:i+1,postNumber:1,createdAt:`2026-10-${String(i+1).padStart(2,'0')}T12:00:00Z`,title:`${username} ${type}`}))).flat()};
    }}};
  vm.runInNewContext(script,{fluxdo:api});const ctx={surface:'test',kind:'page',api,setData:(k,v)=>data[k]=structuredClone(v)};
  return {data,people,opened,sent,grants,asked,reads,agree:v=>accept=v,run:(event,args={})=>events.get(event)(ctx,args),snapshot:()=>stored,day:n=>day=n,drop:name=>drop=name,pause:fn=>pause=fn};
}
test('导入关注分页、保留旧名单、50人上限及移除',async()=>{
  const p=setup();await p.run('add',{value:'personal'});p.people.push(...Array.from({length:55},(_,i)=>`member${i}`));
  await p.run('import');assert.equal(p.opened.at(-1).page,'following');await p.run('candidates');
  await p.run('candidates',{more:true});await p.run('candidates',{more:true});assert.equal(p.data.choices.length,55);
  for(const u of p.people.slice(0,50))await p.run('pick',{name:u});await p.run('apply');assert.equal(p.data.users.length,1);
  await p.run('pick',{name:p.people[49]});await p.run('apply');assert.equal(p.data.users.length,50);assert.equal(p.data.users[0].name,'personal');
  const user=p.data.users[2];await p.run('remove',{id:user.id});assert.equal(p.data.users.length,49);
  await p.run('profile',{name:'personal'});assert.equal(p.opened.at(-1).type,'user');
});
test('打开页面不弹权限框，拒绝没有读取或写入，同意后原操作继续',async()=>{
  const p=setup();p.grants.forumActivity=false;p.agree(false);
  await p.run('page.open');assert.equal(p.asked.length,0);
  await p.run('add',{value:'demo'});assert.deepEqual(p.asked,[['forumActivity']]);assert.deepEqual(p.reads,[]);assert.match(p.data.error,/未允许读取动态/);
  p.agree(true);await p.run('add',{value:'demo'});assert.equal(p.data.users[0].name,'demo');
  p.grants.forumActivity=false;await p.run('page.resume');assert.ok(p.data.needsActivity);assert.ok(p.data.items.length);
  await p.run('unread');assert.equal(p.data.items.length,0);await p.run('reset');assert.ok(p.data.items.length);
});
test('勾选其他页的用户后刷新或筛选仍能添加，点开未缓存订阅只更新此人', async () => {
  const p = setup();
  p.people.push(...Array.from({length: 24}, (_, i) => 'member' + i));
  await p.run('candidates');
  await p.run('pick', {name: 'member0'});
  await p.run('candidates', {more: true});
  await p.run('pick', {name: 'member23'});
  await p.run('candidates');
  await p.run('query', {value: 'member0'});
  await p.run('apply');
  assert.deepEqual(p.data.users.map(u => u.name), ['member0', 'member23']);
  const before = p.reads.length;
  await p.run('select', {who: 'member23'});
  assert.deepEqual(p.reads.slice(before), ['actions', 'reactions', 'boosts']);
  assert.ok(p.data.items.length && p.data.items.every(item => item.name === 'member23'));
});
test('五类动态、首轮基线、去重、筛选与已读，不重复发送通知',async()=>{
  const p=setup();await p.run('add',{value:'demo'});assert.equal(p.data.items.length,5);assert.match(p.data.title,/0 条未读/);
  await p.run('notify');p.day(2);await p.run('task.run',{id:'refresh'});await p.run('page.resume');assert.match(p.data.title,/5 条未读/);assert.equal(p.sent.length,1);
  await p.run('task.run',{id:'refresh'});assert.equal(p.sent.length,1);await p.run('select',{kind:'boosts'});assert.equal(p.data.items.length,2);
  await p.run('topic',p.data.items[0]);assert.equal(p.opened.at(-1).type,'topic');assert.match(p.data.title,/4 条未读/);
  await p.run('read');assert.match(p.data.title,/0 条未读/);p.day(4);await p.run('refresh');assert.ok(Object.values(p.snapshot().feed)[0].items.length<=10);
});
test('失效账号不会挡住后续订阅，迟到的刷新不能重建已移除的名单',async()=>{
  const p=setup();await p.run('add',{value:'first'});await p.run('add',{value:'second'});p.drop('first');
  await assert.rejects(p.run('task.run',{id:'refresh'}));await p.run('task.run',{id:'refresh'});p.drop('');
  const started=Promise.withResolvers(),resume=Promise.withResolvers();p.pause(async()=>{started.resolve();await resume.promise;});
  const pending=p.run('task.run',{id:'refresh'});await started.promise;const id=p.data.users[0].id;await p.run('remove',{id});resume.resolve();await pending;
  assert.ok(!p.snapshot().feed[id]);assert.equal(p.snapshot().users.length,1);
});
