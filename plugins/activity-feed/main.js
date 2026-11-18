(() => {
  'use strict';
  const key = 'subscriptions.v1', maxUsers = 50, keep = 10;
  const labels = {topics:'发帖', replies:'回复', likes:'赞', reactions:'回应', boosts:'Boost'};
  const views = new Map();
  const empty = () => ({users:[], feed:{}, serial:0, cursor:0});
  const state = async api => (await api.storage.get(key)) || empty();
  const identity = name => name.toLowerCase();
  const valid = name => typeof name === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,59}$/.test(name);
  // 每次注册分配序号；移除后重新添加也不能接收旧请求的结果。
  function add(s, name) {
    if (!valid(name) || s.users.some(u=>identity(u.name)===identity(name)) || s.users.length>=maxUsers) return false;
    s.users.push({name, id:++s.serial}); return true;
  }
  async function edit(api, apply) {
    for (let attempt=0; attempt<6; attempt++) {
      const old = await api.storage.get(key), next = old ? JSON.parse(JSON.stringify(old)) : empty();
      const value=apply(next);
      if (await api.storage.compareAndSet(key,old,next)) return {s:next,value};
    }
    throw new Error('订阅刚刚发生变化，请重试');
  }
  const rows = s => s.users.flatMap(u=>(s.feed[u.id]?.items || []).map(item=>({...item, name:u.name, owner:u.id})))
    .sort((a,b)=>b.time.localeCompare(a.time)||a.id.localeCompare(b.id));
  const unread = s => rows(s).filter(item=>item.unread).length;
  async function badge(api) {
    // 写入后重读，避免另一实例同时标为已读导致旧角标覆盖新值。
    for (let i=0;i<3;i++) {
      const count=unread(await state(api)); await api.navigation.setBadge('feed',count);
      if (count===unread(await state(api))) return count;
    }
  }
  async function fetchSource(api, name, resource) {
    try { return (await api.forum.read({resource,username:name})).items; }
    catch (e) { if (resource!=='actions' && e.message==='forum_not_found') return []; throw e; }
  }
  function compact(item,kind) {
    const type = kind==='actions'?item.action:kind;
    if (!Object.hasOwn(labels,type) || !item.id || !(item.topicId>0) || !item.createdAt) return null;
    return {id:`${type}:${item.id}`.slice(0,180), type, time:String(item.createdAt).slice(0,32),
      topic:item.topicId, post:item.postNumber||1, title:String(item.title||'无标题话题').slice(0,140), unread:false};
  }
  async function refresh(api, preferred) {
    const first=await state(api), u=first.users.find(x=>x.name===preferred) || first.users[first.cursor%first.users.length];
    if (!u) return;
    const incoming=[];
    try {
      for (const source of ['actions','reactions','boosts']) {
        for (const item of await fetchSource(api,u.name,source)) {
          const row=compact(item,source); if(row) incoming.push(row);
        }
      }
    } catch(e) {
      // 单个账号已删除或数据不可用时，下次到期继续轮转；共享限流仍交给宿主退避。
      await edit(api,s=>{const i=s.users.findIndex(x=>x.id===u.id);if(i>=0)s.cursor=(i+1)%s.users.length;});
      throw e;
    }
    const {value:added} = await edit(api,s=>{
      const idx=s.users.findIndex(x=>x.id===u.id); if(idx<0) return 0;
      const last=s.feed[u.id], merged=new Map((last?.items||[]).map(x=>[x.id,x]));
      const water={...last?.water}; let count=0;
      for (const row of incoming) {
        if(!merged.has(row.id)) {
          // 同一秒可有多个动态；比较各类型上次最高时间，避免把补齐的旧历史算作新消息。
          const isNew=!!last && (!last.water[row.type] || row.time>=last.water[row.type]);
          merged.set(row.id,{...row,unread:isNew});
        }
        if(!water[row.type] || row.time>water[row.type]) water[row.type]=row.time;
      }
      const items=[...merged.values()].sort((a,b)=>b.time.localeCompare(a.time)||a.id.localeCompare(b.id)).slice(0,keep);
      const prior=new Set((last?.items||[]).map(x=>x.id));
      count=items.filter(x=>x.unread&&!prior.has(x.id)).length;
      s.feed[u.id]={items,water}; s.cursor=(idx+1)%s.users.length; return count;
    });
    const n=await badge(api);
    if(added && n && await api.notifications.isAllowed()) {
      try { await api.notifications.show({key:'activity', title:'有新的订阅动态', body:`${u.name} 有新动态，共 ${n} 条未读`,page:'feed'}); }
      catch(e) { if(e.message!=='notification_permission_denied') throw e; }
    }
  }
  const local = ctx => {if (!views.has(ctx.surface)) views.set(ctx.surface,{who:'',kind:'',take:40,input:'',busy:false}); return views.get(ctx.surface);};
  async function render(ctx) {
    const v=local(ctx), seq=v.seq=(v.seq||0)+1;
    const s=await state(ctx.api), scheduled=(await ctx.api.tasks.list()).find(t=>t.id==='refresh');
    const notify=await ctx.api.notifications.isAllowed();
    if(v.seq!==seq) return;
    if(!s.users.some(u=>u.name===v.who)) v.who='';
    const filtered=rows(s).filter(x=>(!v.who||x.name===v.who)&&(!v.kind||x.type===v.kind));
    const date = time => {const d=new Date(time);return Number.isNaN(d.getTime())?'':`${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
    const model={users:s.users, hasUsers:!!s.users.length, who:v.who||'全部用户', filters:!!v.filters,
      title:`${s.users.length} 位订阅 · ${unread(s)} 条未读`, input:v.input, manual:v.busy,
      empty:s.users.length?'暂无符合条件的动态':'还没有订阅', error:v.error||'',
      people:[{name:'',label:'全部用户',selected:!v.who},...s.users.map(u=>({name:u.name,label:u.name,selected:v.who===u.name}))],
      types:[{id:'',label:'全部',selected:!v.kind},...Object.entries(labels).map(([id,label])=>({id,label,selected:id===v.kind}))],
      items:filtered.slice(0,v.take).map(x=>({...x,meta:`${x.unread?'未读 · ':''}${x.name} · ${labels[x.type]} · ${date(x.time)}`})),
      more:filtered.length>v.take, enabled:!!scheduled, background:scheduled?.background===true, notify,
      pace:[10,30,60].map(n=>({n,label:`${n} 秒`,selected:n===(scheduled?.intervalSeconds||30)})),
      scheduleError:scheduled?.error?'更新未完成，将自动重试':''};
    for(const [k,val] of Object.entries(model)) ctx.setData(k,val);
  }
  const on=(name,fn)=>fluxdo.on(name,async(ctx,args)=>{
    const v=local(ctx); try { v.error=''; await fn(ctx,args,v); }
    catch(e){const messages={forum_rate_limited:'论坛请求较多，请稍后再试',forum_auth_required:'请先登录论坛',forum_not_found:'没有找到这个用户',forum_forbidden:'当前账号无法读取这些动态',forum_network_error:'网络连接失败，请重试'};v.error=messages[e.message]||String(e.message||e);}
    await render(ctx);
  });
  for(const event of ['page.open','page.resume','card.load','card.refresh','task.updated']) fluxdo.on(event,render);
  fluxdo.on('surface.close',ctx=>{views.delete(ctx.surface);});
  fluxdo.on('task.run',(ctx,args)=>args.id==='refresh'?refresh(ctx.api):undefined);
  fluxdo.on('feed',ctx=>ctx.api.navigate('feed'));
  fluxdo.on('manage',ctx=>ctx.api.navigate('settings'));
  fluxdo.on('input',(ctx,a)=>{local(ctx).input=String(a.value||'').trim().replace(/^@/,'');});
  on('add',async(ctx,a,v)=>{
    const name=String(a.value||v.input).trim().replace(/^@/,''); if(!valid(name)) throw new Error('请输入有效的论坛用户名');
    const user=await ctx.api.forum.read({resource:'user',username:name});
    if(!(await edit(ctx.api,s=>add(s,user.username))).value) throw new Error('该用户已在名单中，或已达 50 人上限');
    v.input=''; await refresh(ctx.api,user.username);
  });
  on('remove',async(ctx,a)=>{await edit(ctx.api,s=>{s.users=s.users.filter(u=>u.id!==a.id);delete s.feed[a.id];}); await badge(ctx.api);});
  on('import',async ctx=>{
    const account=await ctx.api.user.get(); if(!account) throw new Error('请先登录论坛');
    let cursor=0, total=0;
    while(cursor!==null && cursor<=10000 && (await state(ctx.api)).users.length<maxUsers) {
      const page=await ctx.api.forum.read({resource:'following',username:account.username,offset:cursor});
      total+=(await edit(ctx.api,s=>page.items.filter(u=>add(s,u.username)).length)).value;
      if(page.nextOffset===null || page.nextOffset<=cursor) break; cursor=page.nextOffset;
    }
    await ctx.api.toast(total?`已添加 ${total} 位用户`:'没有可新增的订阅');
  });
  const manual=async(ctx,_,v)=>{if(v.busy)return;v.busy=true;ctx.setData('manual',true);try{await refresh(ctx.api,v.who);}finally{v.busy=false;}};
  on('refresh',manual); on('page.refresh',manual);
  on('filters',async(_,a,v)=>{v.filters=!v.filters;});
  on('select',async(_,a,v)=>{if('who' in a) v.who=a.who;if('kind' in a)v.kind=a.kind;v.take=40;});
  on('more',async(_,a,v)=>{v.take+=40;});
  on('read',async ctx=>{await edit(ctx.api,s=>{for(const user of Object.values(s.feed))for(const row of user.items)row.unread=false;});await badge(ctx.api);await ctx.api.notifications.cancel('activity');});
  on('topic',async(ctx,a)=>{await ctx.api.forum.open({type:'topic',topicId:a.topic,postNumber:a.post});await edit(ctx.api,s=>{const row=s.feed[a.owner]?.items.find(x=>x.id===a.id);if(row)row.unread=false;});await badge(ctx.api);});
  fluxdo.on('profile',(ctx,a)=>ctx.api.forum.open({type:'user',username:a.name}));
  on('schedule',async(ctx,a)=>{
    const task=(await ctx.api.tasks.list()).find(t=>t.id==='refresh');
    if(a.mode==='enable' && task){await ctx.api.tasks.cancel('refresh');return;}
    if(!(await state(ctx.api)).users.length)throw new Error('请先添加订阅用户');
    await ctx.api.tasks.schedule({id:'refresh',intervalSeconds:a.pace||task?.intervalSeconds||30,
      background:a.mode==='background'?!task?.background:!!task?.background});
  });
  on('notify',async ctx=>{
    if(await ctx.api.notifications.isAllowed()) await ctx.api.notifications.revoke();
    else await ctx.api.notifications.requestPermission();
  });
})();
