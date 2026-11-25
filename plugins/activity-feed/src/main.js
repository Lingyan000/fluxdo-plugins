(() => {
  'use strict';
  const key = 'subscriptions.v1', maxUsers = 50, keep = 200;
  const labels = {topics:'发帖', replies:'回复', likes:'赞', reactions:'回应', boosts:'Boost'};
  const views = new Map();
  const profiles=fluxdoData.createQueryClient({maxEntries:50,maxBytes:262144});
  async function profile(api,name){const user=await api.user.get();profiles.setIdentity(user?.id??user?.username??null);return profiles.query(name.toLowerCase(),()=>api.forum.read({resource:'user',username:name}),{ttl:60000});}
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
  const compareRows=(a,b)=>b.time.localeCompare(a.time)||a.id.localeCompare(b.id)||(a.owner||0)-(b.owner||0);
  const inWindow=(row,v)=>!v.before||compareRows(row,v.before)>0;
  const rows = s => s.users.flatMap(u=>(s.feed[u.id]?.items || []).map(item=>({...item, name:u.name, owner:u.id})))
    .sort(compareRows);
  const unread = s => rows(s).filter(item=>item.unread).length;
  const plain = value => String(value || '').slice(0,4096).replace(/<[^>]*>/g,' ').replace(/&(amp|lt|gt|quot|nbsp|#39);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',nbsp:' ','#39':"'"})[e]).replace(/\s+/g,' ').trim().slice(0,180);
  const accessLabels = {forumActivity:'读取动态',forumProfiles:'读取用户资料',forumFollowing:'读取关注列表',identity:'读取当前账号',background:'后台刷新',notifications:'通知'};
  function feedback(error) {
    const reason = error.message || String(error);
    if (reason.startsWith('permission_denied:')) return `「${accessLabels[reason.split(':')[1]] || '此功能'}」权限已关闭，可在插件管理的权限设置中开启。`;
    const messages = {activity_refresh_busy:'另一轮更新正在进行，请稍后查看', activity_cancelled:'页面已离开，更新已暂停', forum_rate_limited:'论坛请求较多，请稍后再试', forum_auth_required:'请先登录论坛', forum_not_found:'没有找到这个用户', forum_forbidden:'当前账号无法读取这些动态', forum_network_error:'网络连接失败，请重试', task_development_preview_only:'请安装插件后使用系统任务和通知'};
    return messages[reason] || reason;
  }
  // 在开发会话中仍可阅读、选择和订阅，不创建正式角标或任务。
  async function previewFallback(operation, fallback) {
    try { return await operation; }
    catch (error) { if (error.message === 'task_development_preview_only') return fallback; throw error; }
  }
  async function access(ctx, names) {
    names=[...new Set(['identity',...names])];
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
  const sources = ['actions','reactions','boosts'];
  const stopErrors = new Set(['forum_rate_limited','forum_auth_required','forum_forbidden','forum_account_changed','forum_not_visible','task_cancelled']);
  const pause = ms => new Promise(done=>setTimeout(done,ms));
  function compact(item,kind) {
    const type=kind==='actions'?item.action:kind;
    if(!Object.hasOwn(labels,type)||!item.id||!(item.topicId>0)||!item.createdAt)return null;
    return {id:`${type}:${item.id}`.slice(0,180),type,time:String(item.createdAt).slice(0,32),topic:item.topicId,post:item.postNumber||1,
      title:plain(item.title)||'无标题话题',summary:plain(item.excerpt||item.cooked),reaction:String(item.reaction||'').slice(0,32),unread:false};
  }
  // 请求预算存在账号存储中，前台页面与系统任务共用；为其他论坛操作预留余量。
  async function reserve(api, wait, active) {
    for(;;){
      if(!active())throw Error("activity_cancelled");
      const now=Date.now();
      const {value:delay}=await edit(api,s=>{
        s.requests=(s.requests||[]).filter(t=>t>now-60000);
        const until=Math.max(s.cooldown||0,s.requests.length>=90?s.requests[0]+60100:0);
        if(until>now)return until-now;
        s.requests.push(now);return 0;
      });
      if(!delay)return;
      if(!wait)throw Error('activity_budget');
      await pause(Math.min(delay,1000));
      if(!active())throw Error('activity_cancelled');
    }
  }
  async function fetchSource(api,user,resource,cursor,{wait=false,active=()=>true}={}){
    await reserve(api,wait,active);
    if(!active())throw Error('activity_cancelled');
    try {
      const args={resource,username:user.name};
      if(cursor!=null)args[resource==='actions'?'offset':'before']=cursor;
      const result=await api.forum.read(args);
      if(!active())throw Error('activity_cancelled');
      const items=Array.isArray(result.items)?result.items:[];
      const next=resource==='actions'?result.nextOffset:result.nextBefore;
      const advances=Number.isInteger(next)&&next>0&&(cursor==null||(resource==='actions'?next>cursor:next<cursor));
      return {items,next:items.length&&advances?next:null};
    }catch(error){
      if(error.message==='forum_rate_limited'||error.message==='forum_forbidden')await edit(api,s=>{s.cooldown=Date.now()+60000;});
      if(resource!=='actions'&&error.message==='forum_not_found')return {items:[],next:null};
      throw error;
    }
  }
  function trimCache(s){
    for(const feed of Object.values(s.feed))feed.items=feed.items.slice(0,keep);
    // 留出头像、游标和账号配置空间；持久缓存有界，继续阅读的历史保存在页面中。
    while(JSON.stringify(s).length>520000){
      const oldest=Object.values(s.feed).filter(f=>f.items.length>1).sort((a,b)=>a.items.at(-1).time.localeCompare(b.items.at(-1).time))[0];
      if(!oldest)break;oldest.items.pop();
    }
  }
  const sourceOf = row => ['topics','replies','likes'].includes(row.type)?'actions':row.type;
  async function refreshUser(api,user,options){
    let added=0;
    for(let visit=0;visit<sources.length;visit++){
      if(!options.active()||Date.now()>=options.deadline)break;
      const snapshot=await state(api),previous=snapshot.feed[user.id];
      if(!snapshot.users.some(u=>u.id===user.id))return {added,completed:true};
      const source=sources[previous?.nextSource||0],continuation=previous?.pending?.[source];
      const cursor=continuation?.cursor??null;
      const initialized=previous?.initialized?previous.initialized[source]===true:!!previous;
      const boundary=continuation?.boundary??previous?.sourceWater?.[source]??
        Object.entries(previous?.water||{}).filter(([type])=>sourceOf({type})===source).map(([,time])=>time).sort().at(-1)??null;
      const result=await fetchSource(api,user,source,cursor,options);
      const incoming=result.items.map(item=>compact(item,source)).filter(Boolean);
      const reached=boundary&&incoming.some(row=>row.time<boundary);
      const pending=initialized&&result.next!=null&&!reached?{cursor:result.next,boundary}:null;
      // 每页提交后再请求下一页，系统终止任务时最多重取当前页。
      const {value:count}=await edit(api,s=>{
        const index=s.users.findIndex(u=>u.id===user.id);if(index<0)return 0;
        const old=s.feed[user.id],merged=new Map((old?.items||[]).map(row=>[row.id,row]));let count=0;
        const water={...old?.water},sourceWater={...old?.sourceWater};
        for(const row of incoming){
          const prior=merged.get(row.id),since=continuation?.boundary??old?.water?.[row.type]??boundary;
          const isNew=initialized&&!prior&&(!since||row.time>=since);
          merged.set(row.id,{...row,unread:prior?.unread??isNew});if(isNew)count++;
          if(!water[row.type]||row.time>water[row.type])water[row.type]=row.time;
          if(!sourceWater[source]||row.time>sourceWater[source])sourceWater[source]=row.time;
        }
        const actor=result.items.find(item=>item.actor?.avatarUrl&&identity(item.actor.username||'')===identity(user.name))?.actor;
        if(actor)s.users[index].avatar=String(actor.avatarUrl).slice(0,512);
        const nextSource=(sources.indexOf(source)+1)%sources.length;
        s.feed[user.id]={...old,items:[...merged.values()].sort(compareRows),water,sourceWater,
          pending:{...old?.pending,[source]:pending},initialized:{...old?.initialized,[source]:true},nextSource,updatedAt:Date.now()};
        if(nextSource===0)s.cursor=(index+1)%s.users.length;
        trimCache(s);return count;
      });
      added+=count;
      if(source===sources.at(-1))break;
    }
    const current=(await state(api)).feed[user.id];
    return {added,completed:current?.nextSource===0};
  }
  async function refresh(api,preferred,{background=false,progress=()=>{},active=()=>true,manual=false}={}){
    const token=String(Date.now())+':'+Math.random();
    const locked=await edit(api,s=>{
      if(s.refreshLease?.until>Date.now())return false;
      s.refreshLease={token,until:Date.now()+90000};return true;
    });
    if(!locked.value)throw Error('activity_refresh_busy');
    let completed=0,added=0,failed=0,lastError='';
    try{
      const first=locked.s,selected=first.users.filter(u=>!preferred||u.name===preferred);
      if(!selected.length)return;
      const cursor=preferred?0:first.cursor%selected.length;
      const users=[...selected.slice(cursor),...selected.slice(0,cursor)];
      const deadline=manual?Infinity:Date.now()+14000;
      for(const user of users){
        if(!active()||Date.now()>=deadline)break;
        await edit(api,s=>{if(s.refreshLease?.token===token)s.refreshLease.until=Date.now()+90000;});
        progress(completed,users.length,user.name);
        try {
          const result=await refreshUser(api,user,{wait:manual,active,deadline});added+=result.added;
          if(result.completed)completed++;
        }catch(error){
          if(error.message==='activity_budget'||error.message==='activity_cancelled')break;
          if(stopErrors.has(error.message)){lastError=error.message;break;}
          failed++;lastError=error.message;
          await edit(api,s=>{const i=s.users.findIndex(u=>u.id===user.id);if(i>=0)s.cursor=(i+1)%s.users.length;});
        }
      }
      await edit(api,s=>{s.lastRefresh={at:Date.now(),completed,total:users.length,failed};});
      const n=await badge(api);
      if(added&&n&&await previewFallback(api.notifications.isAllowed(),false)){
        try{await api.notifications.show({key:'activity',title:'有新的订阅动态',body:`${n} 条未读动态`,page:'feed'});}
        catch(error){if(!['notification_permission_denied','notification_system_denied'].includes(error.message))throw error;}
      }
      progress(completed,users.length,'');
      if(lastError)throw Error(lastError);
      return {completed,total:users.length,failed,background};
    }finally{await edit(api,s=>{if(s.refreshLease?.token===token)delete s.refreshLease;});}
  }
  const relevant=(source,kind)=>!kind||(source==='actions'?['topics','replies','likes'].includes(kind):source===kind);
  const maxHistory=400;
  async function history(ctx,v){
    if(v.historyLoading||v.busy||v.history?.size>=maxHistory)return;
    if(!await access(ctx,['forumActivity']))return;
    v.historyLoading=true;ctx.setData('historyLoading',true);v.historyError='';
    try{
      const s=await state(ctx.api),users=s.users.filter(u=>!v.who||u.name===v.who);
      v.history??=new Map();v.cursors??=new Map();
      const jobs=users.flatMap(user=>sources.filter(source=>relevant(source,v.kind)).map(source=>({user,source})));
      for(let requests=0;requests<12&&jobs.length&&v.history.size<maxHistory;requests++){
        if(v.hidden||views.get(ctx.surface)!==v)break;
        let job;
        for(let visit=0;visit<jobs.length;visit++){
          const i=(v.historyPosition||0)%jobs.length;v.historyPosition=i+1;
          const candidate=jobs[i];if(v.cursors.get(candidate.user.id+':'+candidate.source)!==null){job=candidate;break;}
        }
        if(!job)break;
        const {user,source}=job,key=user.id+':'+source;
        const cursor=v.cursors.get(key);
        const page=await fetchSource(ctx.api,user,source,cursor,{wait:true,active:()=>!v.hidden&&views.get(ctx.surface)===v});
        for(const item of page.items){const row=compact(item,source);if(row&&inWindow({...row,owner:user.id},v))v.history.set(user.id+':'+row.id,{...row,owner:user.id,name:user.name,unread:false});}
        v.cursors.set(key,page.next);
        // 一次响应最多 100 条；窗口达到上限后由用户明确翻到下一段，避免无限堆积。
        if(v.history.size>=maxHistory)break;
      }
      v.take=Math.min(v.take+40,maxHistory);
    }catch(error){if(error.message!=='activity_cancelled')v.historyError=feedback(error);}
    finally{v.historyLoading=false;}
  }
  const local = ctx => {if (!views.has(ctx.surface)) views.set(ctx.surface,{who:'',kind:'',take:40,input:'',busy:false}); return views.get(ctx.surface);};
  async function render(ctx) {
    const v=local(ctx), seq=v.seq=(v.seq||0)+1;
    const grants=await ctx.api.permissions.status();
    let s, scheduled, notify=false, notification={authorized:false,system:'unknown',canOpenSettings:false};
    try {
      s=await state(ctx.api);
      scheduled=(await previewFallback(ctx.api.tasks.list(), [])).find(t=>t.id==='refresh');
      if(grants.notifications)notification=await previewFallback(ctx.api.notifications.status(),notification);
      notify=!!grants.notifications && notification.authorized;
    } catch(e) {
      if(!['forum_auth_required','permission_denied:identity'].includes(e.message))throw e;
      s=empty();v.error ||= e.message==='forum_auth_required'?'请先登录 FluxDO 论坛账号，再添加订阅。':feedback(e);
    }
    if(v.seq!==seq) return;
    if(!s.users.some(u=>u.name===v.who)) v.who='';
    const saved=rows(s), merged=new Map((v.history?[...v.history.values()]:[]).filter(row=>s.users.some(u=>u.id===row.owner)).map(row=>[row.owner+':'+row.id,row]));
    for(const row of saved)if(inWindow(row,v))merged.set(row.owner+':'+row.id,row);
    const timeline=[...merged.values()].sort(compareRows),totalUnread=saved.filter(x=>x.unread).length;
    const older=s.users.filter(u=>!v.who||u.name===v.who).some(u=>sources.some(source=>{
      if(v.kind&&(source==='actions'?!['topics','replies','likes'].includes(v.kind):source!==v.kind))return false;
      return v.cursors?.get(u.id+':'+source)!==null;
    }));
    const filtered=timeline.filter(x=>(!v.who||x.name===v.who)&&(!v.kind||x.type===v.kind)&&(!v.unreadOnly||x.unread));
    const counts=new Map(); for (const row of timeline) if(row.unread)counts.set(row.owner,(counts.get(row.owner)||0)+1);
    const people=[{name:'',avatar:'',label:'全部',count:totalUnread,selected:!v.who},...s.users.map(u=>({name:u.name,avatar:u.avatar||'',label:u.name,count:counts.get(u.id)||0,selected:v.who===u.name}))];
    const existing=new Set(s.users.map(u=>identity(u.name)));
    const choices=(v.candidates||[]).filter(u=>identity(u.username).includes(identity(v.query||''))).map(u=>({...u,
      chosen:v.chosen?.has(identity(u.username))||false, added:existing.has(identity(u.username))}));
    const model={stats:[{label:"订阅用户",value:String(s.users.length)},{label:"未读动态",value:String(totalUnread)}],users:s.users, hasUsers:!!s.users.length, filtered:!!(v.who||v.kind||v.unreadOnly),
      title:`${s.users.length} 位订阅 · ${totalUnread} 条未读`, input:v.input, bulk:v.bulk||'', manual:v.busy, submitting:!!v.submitting,
      empty:!s.users.length?'还没有订阅':v.unreadOnly?'没有未读动态':v.kind?'没有这类动态':'暂无动态', error:v.error||'',
      people, unreadOnly:!!v.unreadOnly, hasUnread:totalUnread>0, needsActivity:!!s.users.length&&!grants.forumActivity,
      choices, query:v.query||'', pickLabel:`添加所选（${v.chosen?.size||0}）`, canPick:!!v.chosen?.size,
      candidatesLoading:!!v.candidatesLoading, candidatesError:v.candidatesError||'', nextCandidates:v.next!=null,
      types:[{id:'',label:'全部',selected:!v.kind},...Object.entries(labels).map(([id,label])=>({id,label,selected:id===v.kind}))],
      items:filtered.slice(0,v.take).map(x=>({...x,summary:x.summary||'',avatar:s.users.find(u=>u.id===x.owner)?.avatar||'',
        meta:`${x.name} · ${labels[x.type]}${x.reaction?' '+x.reaction:''}${x.unread?' · 未读':''}`})),
      more:v.take<maxHistory&&(filtered.length>v.take||(!v.unreadOnly&&older&&!(v.history?.size>=maxHistory))), historyWindowEnd:(v.take>=maxHistory||v.history?.size>=maxHistory)&&(filtered.length>v.take||older), olderWindow:!!v.olderWindow, historyLoading:!!v.historyLoading, historyError:v.historyError||'', progress:v.progress||'', enabled:!!scheduled, background:scheduled?.background===true, notify, notificationBlocked:notify&&notification.system==='denied', notificationUnknown:notify&&notification.system==='unknown', notificationSettings:!!notification.canOpenSettings,
      pace:[10,30,60].map(n=>({n,label:`${n} 秒`,selected:n===(scheduled?.intervalSeconds||30)})),
      scheduleError:scheduled?.error?'更新未完成，将自动重试':''};
    v.lastWindow=filtered.slice(0,v.take);
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
  for(const event of ['page.resume','card.load','card.refresh','task.updated']) fluxdo.on(event,ctx=>{local(ctx).hidden=false;return render(ctx);});
  on('page.open',async(ctx,_,v)=>{if(ctx.page==='following')await loadFollowing(ctx,v);});
  fluxdo.on('surface.close',ctx=>{views.get(ctx.surface)?.followingPager?.dispose();views.delete(ctx.surface);});
  fluxdo.on('task.run',(ctx,args)=>args.id==='refresh'?refresh(ctx.api,null,{background:!!args.background}):undefined);
  fluxdo.on('page.hide',ctx=>{const v=local(ctx);v.hidden=true;v.followingPager?.cancel();});
  fluxdo.on('card.hide',ctx=>{local(ctx).hidden=true;});
  fluxdo.on('feed',ctx=>ctx.api.navigate('feed'));
  fluxdo.on('manage',ctx=>ctx.api.navigate('settings'));
  fluxdo.on('new',ctx=>ctx.api.navigate('add'));
  fluxdo.on('bulk',ctx=>ctx.api.navigate('bulk'));
  on('bulkInput',async(_,a,v)=>{v.bulk=String(a.value||'').slice(0,8000);});
  onSubmit('bulkApply',async(ctx,_,v)=>{
    if(!await access(ctx,['forumProfiles','forumActivity']))return;
    const names=[...new Map(String(v.bulk||'').split(/[\s,;，；]+/).map(n=>n.replace(/^@/,'')).filter(Boolean).map(n=>[identity(n),n])).values()];
    if(!names.length||names.some(n=>!valid(n)))throw Error('请输入用户名，每行一位，也可用空格或逗号分隔');
    const s=await state(ctx.api),existing=new Set(s.users.map(u=>identity(u.name)));
    const fresh=names.filter(n=>!existing.has(identity(n)));
    if(s.users.length+fresh.length>maxUsers)throw Error('最多订阅 50 人，请减少名单');
    const users=[];
    for(const name of fresh){
      await reserve(ctx.api,true,()=>!v.hidden&&views.get(ctx.surface)===v);
      const user=await profile(ctx.api,name);if(!valid(user.username))throw Error('没有找到这个用户');users.push(user);
    }
    const {value:count}=await edit(ctx.api,s=>{let count=0;for(const user of users)if(add(s,user.username,user.avatarUrl))count++;return count;});
    v.bulk='';await ctx.api.toast('已导入 '+count+' 位订阅');await ctx.api.navigation.dismiss();
  });
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
    const user=await profile(ctx.api,name);
    if(!(await edit(ctx.api,s=>add(s,user.username,user.avatarUrl))).value) throw new Error('该用户已在名单中，或已达 50 人上限');
    v.input=''; ctx.setData('input',''); await finishAdd(ctx,user.username,`已订阅 ${user.username}`);
  });
  on('remove',async(ctx,a)=>{await edit(ctx.api,s=>{s.users=s.users.filter(u=>u.id!==a.id);delete s.feed[a.id];}); await badge(ctx.api);});
  on('import',async ctx=>{if(await access(ctx,['identity','forumFollowing']))await ctx.api.navigate('following');});
  async function loadFollowing(ctx,v,more=false){
    if(v.candidatesLoading || (more && v.next==null))return;
    v.candidatesError='';v.retryMore=more;
    try {
      const account=await ctx.api.user.get();if(!account)throw Error('forum_auth_required');
      v.followingPager??=fluxdoData.createPagedList({
        itemKey:user=>identity(user.username),
        load:async({cursor,identity:owner})=>{
          const offset=cursor??0;
          const page=await ctx.api.forum.read({resource:'following',username:owner,offset});
          return {items:page.items.filter(user=>valid(user.username)),nextCursor:page.nextOffset>offset?page.nextOffset:null};
        },
        onChange:state=>{if(views.get(ctx.surface)!==v)return;v.candidatesLoading=state.loading||state.loadingMore;v.candidates=state.items;v.next=state.nextCursor;ctx.setData('candidatesLoading',v.candidatesLoading);}
      });
      v.followingPager.reset(account.username);v.chosen??=new Map();
      await v.followingPager.load({more});
    }catch(error){if(error.name!=='QueryCancelledError')v.candidatesError=feedback(error);}
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
    try {await refresh(ctx.api,v.who,{manual:true,active:()=>!v.hidden&&views.get(ctx.surface)===v,progress:(done,total,name)=>{v.progress=name?('正在更新 '+done+'/'+total+' · '+name):('已更新 '+done+'/'+total);ctx.setData('progress',v.progress);}});}finally{v.busy=false;}
  };
  on('refresh',manual); on('page.refresh',manual);
  on('select',async(ctx,a,v)=>{
    if('kind' in a)v.kind=a.kind;
    v.take=40;v.history=new Map();v.cursors=new Map();v.olderWindow=false;v.before=null;
    if(!('who' in a))return;
    v.who=v.who===a.who?'':a.who;
    if(!v.who)return;
    const s=await state(ctx.api), user=s.users.find(u=>u.name===v.who);
    if(user&&!s.feed[user.id]) {await render(ctx);await manual(ctx,{},v);}
  });
  on('unread',async(_,a,v)=>{v.unreadOnly=!v.unreadOnly;v.take=40;});
  on('reset',async(_,a,v)=>{v.who='';v.kind='';v.unreadOnly=false;v.take=40;v.history=new Map();v.cursors=new Map();v.olderWindow=false;v.before=null;});
  on('historyNext',async(ctx,a,v)=>{
    const last=v.lastWindow?.at(-1);if(!last)return;
    v.before={time:last.time,id:last.id,owner:last.owner};v.history=new Map();v.cursors=new Map();v.olderWindow=true;v.take=40;
    await history(ctx,v);
  });
  on('more',async(ctx,a,v)=>{
    if(v.historyLoading||v.busy)return;
    const s=await state(ctx.api),all=[...rows(s).filter(row=>inWindow(row,v)),...(v.history?[...v.history.values()]:[])];
    const count=new Set(all.filter(x=>(!v.who||x.name===v.who)&&(!v.kind||x.type===v.kind)&&(!v.unreadOnly||x.unread)).map(x=>x.owner+':'+x.id)).size;
    if(count>v.take)v.take=Math.min(v.take+40,maxHistory);else await history(ctx,v);
  });
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
  on('notificationSettings',ctx=>ctx.api.notifications.openSettings());
  on('notify',async ctx=>{
    if(await ctx.api.notifications.isAllowed()) await ctx.api.notifications.revoke();
    else if(!await ctx.api.notifications.requestPermission()) local(ctx).error='通知尚未开启。可再次点开关申请，并检查系统是否允许 FluxDO 发送通知。';
  });
})();
