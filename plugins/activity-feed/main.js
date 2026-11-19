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
  function add(s, name, avatar = '') {
    if (!valid(name) || s.users.some(u=>identity(u.name)===identity(name)) || s.users.length>=maxUsers) return false;
    s.users.push({name, avatar: String(avatar || '').slice(0,512), id:++s.serial}); return true;
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
  const plain = value => String(value || '').slice(0,4096).replace(/<[^>]*>/g,' ').replace(/&(amp|lt|gt|quot|nbsp|#39);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',nbsp:' ','#39':"'"})[e]).replace(/\s+/g,' ').trim().slice(0,180);
  const accessLabels = {forumActivity:'读取动态',forumProfiles:'读取用户资料',forumFollowing:'读取关注列表',identity:'读取当前账号',background:'后台刷新',notifications:'通知'};
  function feedback(error) {
    const reason = error.message || String(error);
    if (reason.startsWith('permission_denied:')) return `「${accessLabels[reason.split(':')[1]] || '此功能'}」权限已关闭，可在页面右上角查看权限。`;
    const messages = {forum_rate_limited:'论坛请求较多，请稍后再试', forum_auth_required:'请先登录论坛', forum_not_found:'没有找到这个用户', forum_forbidden:'当前账号无法读取这些动态', forum_network_error:'网络连接失败，请重试', task_development_preview_only:'请安装插件后使用系统任务和通知'};
    return messages[reason] || reason;
  }
  // 在开发会话中仍可阅读、选择和订阅，不创建正式角标或任务。
  async function previewFallback(operation, fallback) {
    try { return await operation; }
    catch (error) { if (error.message === 'task_development_preview_only') return fallback; throw error; }
  }
  async function access(ctx, names) {
    const status = await ctx.api.permissions.status();
    const missing = names.filter(name => !status[name]);
    if (!missing.length || await ctx.api.permissions.request(missing)) return true;
    local(ctx).error = `未允许${missing.map(name => accessLabels[name]).join('、')}。再次点击此功能可重新申请。`;
    return false;
  }
  async function badge(api) {
    // 写入后重读，避免另一实例同时标为已读导致旧角标覆盖新值。
    for (let i=0;i<3;i++) {
      const count=unread(await state(api)); await previewFallback(api.navigation.setBadge('feed',count), null);
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
      topic:item.topicId, post:item.postNumber||1, title:plain(item.title)||'无标题话题', summary:plain(item.excerpt || item.cooked),
      reaction:String(item.reaction||'').slice(0,32), unread:false};
  }
  async function refresh(api, preferred) {
    const first=await state(api), u=first.users.find(x=>x.name===preferred) || first.users[first.cursor%first.users.length];
    if (!u) return;
    const incoming=[]; let avatar='';
    try {
      for (const source of ['actions','reactions','boosts']) {
        for (const item of await fetchSource(api,u.name,source)) {
          if(item.actor?.avatarUrl && identity(item.actor.username||'')===identity(u.name)) avatar=String(item.actor.avatarUrl).slice(0,512);
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
        } else { merged.set(row.id,{...row,unread:merged.get(row.id).unread}); }
        if(!water[row.type] || row.time>water[row.type]) water[row.type]=row.time;
      }
      const items=[...merged.values()].sort((a,b)=>b.time.localeCompare(a.time)||a.id.localeCompare(b.id)).slice(0,keep);
      const prior=new Set((last?.items||[]).map(x=>x.id));
      count=items.filter(x=>x.unread&&!prior.has(x.id)).length;
      if(avatar) s.users[idx].avatar=avatar;
      s.feed[u.id]={items,water}; s.cursor=(idx+1)%s.users.length; return count;
    });
    const n=await badge(api);
    if(added && n && await previewFallback(api.notifications.isAllowed(), false)) {
      try { await api.notifications.show({key:'activity', title:'有新的订阅动态', body:`${u.name} 有新动态，共 ${n} 条未读`,page:'feed'}); }
      catch(e) { if(e.message!=='notification_permission_denied') throw e; }
    }
  }
  const local = ctx => {if (!views.has(ctx.surface)) views.set(ctx.surface,{who:'',kind:'',take:40,input:'',busy:false}); return views.get(ctx.surface);};
  async function render(ctx) {
    const v=local(ctx), seq=v.seq=(v.seq||0)+1;
    const grants=await ctx.api.permissions.status();
    let s, scheduled, notify=false;
    try {
      s=await state(ctx.api);
      scheduled=(await previewFallback(ctx.api.tasks.list(), [])).find(t=>t.id==='refresh');
      notify=grants.notifications && await previewFallback(ctx.api.notifications.isAllowed(), false);
    } catch(e) { if(e.message!=='forum_auth_required')throw e; s=empty(); v.error='请先登录 FluxDO 论坛账号，再添加订阅。'; }
    if(v.seq!==seq) return;
    if(!s.users.some(u=>u.name===v.who)) v.who='';
    const timeline=rows(s), totalUnread=timeline.filter(x=>x.unread).length;
    const filtered=timeline.filter(x=>(!v.who||x.name===v.who)&&(!v.kind||x.type===v.kind)&&(!v.unreadOnly||x.unread));
    const counts=new Map(); for (const row of timeline) if(row.unread)counts.set(row.owner,(counts.get(row.owner)||0)+1);
    const people=[{name:'',avatar:'',label:'全部',count:totalUnread,selected:!v.who},...s.users.map(u=>({name:u.name,avatar:u.avatar||'',label:u.name,count:counts.get(u.id)||0,selected:v.who===u.name}))];
    const existing=new Set(s.users.map(u=>identity(u.name)));
    const choices=(v.candidates||[]).filter(u=>identity(u.username).includes(identity(v.query||''))).map(u=>({...u,
      chosen:v.chosen?.has(identity(u.username))||false, added:existing.has(identity(u.username))}));
    const model={stats:[{label:"订阅用户",value:String(s.users.length)},{label:"未读动态",value:String(totalUnread)}],users:s.users, hasUsers:!!s.users.length, filtered:!!(v.who||v.kind||v.unreadOnly),
      title:`${s.users.length} 位订阅 · ${totalUnread} 条未读`, input:v.input, manual:v.busy, submitting:!!v.submitting,
      empty:!s.users.length?'还没有订阅':v.unreadOnly?'没有未读动态':v.kind?'没有这类动态':'暂无动态', error:v.error||'',
      people, unreadOnly:!!v.unreadOnly, hasUnread:totalUnread>0, needsActivity:!!s.users.length&&!grants.forumActivity,
      choices, query:v.query||'', pickLabel:`添加所选（${v.chosen?.size||0}）`, canPick:!!v.chosen?.size,
      candidatesLoading:!!v.candidatesLoading, candidatesError:v.candidatesError||'', nextCandidates:v.next!=null,
      types:[{id:'',label:'全部',selected:!v.kind},...Object.entries(labels).map(([id,label])=>({id,label,selected:id===v.kind}))],
      items:filtered.slice(0,v.take).map(x=>({...x,summary:x.summary||'',avatar:s.users.find(u=>u.id===x.owner)?.avatar||'',
        meta:`${x.name} · ${labels[x.type]}${x.reaction?' '+x.reaction:''}${x.unread?' · 未读':''}`})),
      more:filtered.length>v.take, enabled:!!scheduled, background:scheduled?.background===true, notify,
      pace:[10,30,60].map(n=>({n,label:`${n} 秒`,selected:n===(scheduled?.intervalSeconds||30)})),
      scheduleError:scheduled?.error?'更新未完成，将自动重试':''};
    for(const [k,val] of Object.entries(model)) ctx.setData(k,val);
  }
  const on=(name,fn)=>fluxdo.on(name,async(ctx,args)=>{
    const v=local(ctx); try { v.error=''; await fn(ctx,args,v); }
    catch(e){v.error=feedback(e);}
    await render(ctx);
  });
  const onSubmit = (name, submit) => on(name, async (ctx, args, view) => {
    if (view.submitting) return;
    view.submitting = true;
    ctx.setData('submitting', true);
    try { await submit(ctx, args, view); }
    finally { view.submitting = false; }
  });
  for(const event of ['page.resume','card.load','card.refresh','task.updated']) fluxdo.on(event,render);
  on('page.open',async(ctx,_,v)=>{if(ctx.page==='following')await loadFollowing(ctx,v);});
  fluxdo.on('surface.close',ctx=>{views.delete(ctx.surface);});
  fluxdo.on('task.run',(ctx,args)=>args.id==='refresh'?refresh(ctx.api):undefined);
  fluxdo.on('feed',ctx=>ctx.api.navigate('feed'));
  fluxdo.on('manage',ctx=>ctx.api.navigate('settings'));
  fluxdo.on('new',ctx=>ctx.api.navigate('add'));
  fluxdo.on('input',(ctx,a)=>{local(ctx).input=String(a.value||'');ctx.setData('input',local(ctx).input);});
  async function finishAdd(ctx, name, message) {
    try { await refresh(ctx.api, name); }
    catch (error) { local(ctx).error=`${message}，首次更新未完成。${feedback(error)}`; return; }
    await ctx.api.toast(message);
    if(ctx.page==='add'||ctx.page==='following')await ctx.api.navigation.dismiss();
  }
  onSubmit('add',async(ctx,a,v)=>{
    const name=String(a.value||v.input).trim().replace(/^@/,''); if(!valid(name)) throw new Error('请输入有效的论坛用户名');
    if(!await access(ctx,['forumProfiles','forumActivity']))return;
    const user=await ctx.api.forum.read({resource:'user',username:name});
    if(!(await edit(ctx.api,s=>add(s,user.username,user.avatarUrl))).value) throw new Error('该用户已在名单中，或已达 50 人上限');
    v.input=''; ctx.setData('input',''); await finishAdd(ctx,user.username,`已订阅 ${user.username}`);
  });
  on('remove',async(ctx,a)=>{await edit(ctx.api,s=>{s.users=s.users.filter(u=>u.id!==a.id);delete s.feed[a.id];}); await badge(ctx.api);});
  on('import',async ctx=>{if(await access(ctx,['identity','forumFollowing']))await ctx.api.navigate('following');});
  async function loadFollowing(ctx,v,more=false){
    if(v.candidatesLoading || (more && v.next==null))return;
    v.candidatesLoading=true;v.candidatesError='';ctx.setData('candidatesLoading',true);
    try {
      const account=await ctx.api.user.get(); if(!account)throw Error('forum_auth_required');
      const offset=more?v.next:0;
      const page=await ctx.api.forum.read({resource:'following',username:account.username,offset});
      const users=new Map((more?v.candidates:[]).map(u=>[identity(u.username),u]));
      for(const user of page.items)if(valid(user.username))users.set(identity(user.username),user);
      v.candidates=[...users.values()];v.chosen??=new Map();v.next=page.nextOffset>offset?page.nextOffset:null;
    } catch (error) { v.candidatesError=feedback(error); v.retryMore=more; }
    finally { v.candidatesLoading=false; }
  }
  on('candidates',async(ctx,a,v)=>{if(await access(ctx,['identity','forumFollowing']))await loadFollowing(ctx,v,a.retry?!!v.retryMore:!!a.more);});
  on('query',async(_,a,v)=>{v.query=String(a.value||'');});
  on('pick', async (_, args, view) => {
    const user = view.candidates?.find(candidate => candidate.username === args.name);
    if (!user || view.submitting) return;
    const name = identity(user.username);
    if (!view.chosen.delete(name)) view.chosen.set(name, user);
  });
  onSubmit('apply',async(ctx,_,v)=>{
    if(!v.chosen?.size||!await access(ctx,['forumActivity']))return;
    const choices=[...v.chosen.values()];
    const {value:added}=await edit(ctx.api,s=>choices.filter(u=>!s.users.some(x=>identity(x.name)===identity(u.username))).map(u=>{
      if(s.users.length>=maxUsers)throw Error('最多订阅 50 人，请减少选择');
      add(s,u.username,u.avatarUrl);return u.username;
    }));
    v.chosen.clear();if(added.length)await finishAdd(ctx,added[0],`已添加 ${added.length} 位订阅`);
  });
  const manual=async(ctx,_,v)=>{
    if(v.busy || !(await state(ctx.api)).users.length || !await access(ctx,['forumActivity']))return;
    v.busy=true;ctx.setData('manual',true);
    try {await refresh(ctx.api,v.who);}finally{v.busy=false;}
  };
  on('refresh',manual); on('page.refresh',manual);
  on('select',async(ctx,a,v)=>{
    if('kind' in a)v.kind=a.kind;
    v.take=40;
    if(!('who' in a))return;
    v.who=v.who===a.who?'':a.who;
    if(!v.who)return;
    const s=await state(ctx.api), user=s.users.find(u=>u.name===v.who);
    if(user&&!s.feed[user.id]) {await render(ctx);await manual(ctx,{},v);}
  });
  on('unread',async(_,a,v)=>{v.unreadOnly=!v.unreadOnly;v.take=40;});
  on('reset',async(_,a,v)=>{v.who='';v.kind='';v.unreadOnly=false;v.take=40;});
  on('more',async(_,a,v)=>{v.take+=40;});
  on('read',async ctx=>{await edit(ctx.api,s=>{for(const user of Object.values(s.feed))for(const row of user.items)row.unread=false;});await badge(ctx.api);await previewFallback(ctx.api.notifications.cancel('activity'),null);});
  on('topic',async(ctx,a)=>{await ctx.api.forum.open({type:'topic',topicId:a.topic,postNumber:a.post});await edit(ctx.api,s=>{const row=s.feed[a.owner]?.items.find(x=>x.id===a.id);if(row)row.unread=false;});await badge(ctx.api);});
  fluxdo.on('profile',(ctx,a)=>ctx.api.forum.open({type:'user',username:a.name}));
  on('schedule',async(ctx,a)=>{
    const task=(await ctx.api.tasks.list()).find(t=>t.id==='refresh');
    if(a.mode==='enable' && task){await ctx.api.tasks.cancel('refresh');return;}
    if(!(await state(ctx.api)).users.length)throw new Error('请先添加订阅用户');
    const background=a.mode==='background'?!task?.background:!!task?.background;
    if(!await access(ctx,background?['forumActivity','background']:['forumActivity']))return;
    await ctx.api.tasks.schedule({id:'refresh',intervalSeconds:a.pace||task?.intervalSeconds||30,background});
  });
  on('notify',async ctx=>{
    if(await ctx.api.notifications.isAllowed()) await ctx.api.notifications.revoke();
    else if(!await ctx.api.notifications.requestPermission()) local(ctx).error='通知尚未开启。可再次点开关申请，并检查系统是否允许 FluxDO 发送通知。';
  });
})();
