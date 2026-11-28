// 此文件由 fluxdo localize 生成，业务源码与翻译见 src/、locales/。
((host)=>{
 const catalogs={"zh":{"sd6744af200c1901b":"内容已更新，请重新确认清空。","s1ef3de06b32e521b":"清空","s7d301402e595cc87":"清空后无法恢复，是否继续？","sbbf297d364162c60":"清空随手记","se5932f66440940a4":"已自动保存","s570d6020677958bd":"正在保存","s2d1341db7717c694":"正在读取","s8f52fe1c3c78287d":"保存未完成","s22644e8e74fb716c":"{0} 字","s235fda8bb6360899":"记下待办或灵感","sb8784c8dd5636ff2":"重试","s970b8661fca62e57":"随手记","sdcf758e88175ad1a":"保存在设备上的轻量备忘，可在元宇宙中直接编辑。"},"en":{"sd6744af200c1901b":"The note changed. Confirm again to clear it.","s1ef3de06b32e521b":"Clear","s7d301402e595cc87":"This cannot be undone. Clear this note?","sbbf297d364162c60":"Clear note","se5932f66440940a4":"Saved automatically","s570d6020677958bd":"Saving","s2d1341db7717c694":"Loading","s8f52fe1c3c78287d":"Not saved","s22644e8e74fb716c":"{0} characters","s235fda8bb6360899":"Jot down a task or an idea","sb8784c8dd5636ff2":"Retry","s970b8661fca62e57":"Quick notes","sdcf758e88175ad1a":"Lightweight notes stored on this device, editable in Metaverse."},"zh_TW":{"sd6744af200c1901b":"內容已更新，請重新確認清空。","s1ef3de06b32e521b":"清空","s7d301402e595cc87":"清空後無法恢復，是否繼續？","sbbf297d364162c60":"清空隨手記","se5932f66440940a4":"已自動儲存","s570d6020677958bd":"正在儲存","s2d1341db7717c694":"正在讀取","s8f52fe1c3c78287d":"儲存未完成","s22644e8e74fb716c":"{0} 字","s235fda8bb6360899":"記下待辦或靈感","sb8784c8dd5636ff2":"重試","s970b8661fca62e57":"隨手記","sdcf758e88175ad1a":"儲存在裝置上的輕量備忘，可在元宇宙中直接編輯。"},"zh_HK":{"sd6744af200c1901b":"內容已更新，請重新確認清空。","s1ef3de06b32e521b":"清空","s7d301402e595cc87":"清空後無法恢復，是否繼續？","sbbf297d364162c60":"清空隨手記","se5932f66440940a4":"已自動保存","s570d6020677958bd":"正在保存","s2d1341db7717c694":"正在讀取","s8f52fe1c3c78287d":"保存未完成","s22644e8e74fb716c":"{0} 字","s235fda8bb6360899":"記下待辦或靈感","sb8784c8dd5636ff2":"重試","s970b8661fca62e57":"隨手記","sdcf758e88175ad1a":"保存在設備上的輕量備忘，可在元宇宙中直接編輯。"}},titles={};
 let locale="zh",localeTask=null;const contexts=new Map(),records=new Map();
 // 文案标记只用于显示，稳定键可随缓存跨版本保留。
 const prefix='\uE000fluxdo-text:',suffix='\uE001';
 function __text(key,args=[]){return prefix+key+(args.length?':'+encodeURIComponent(JSON.stringify(args)):'')+suffix;}
 function resolve(text,depth=0){if(typeof text!=='string'||depth>4)return text;return text.replace(/\uE000fluxdo-text:([a-z0-9]+)(?::([^\uE001]*))?\uE001/g,(_,key,raw)=>{let value=catalogs[locale][key]||catalogs["zh"][key]||'';if(raw){let args;try{args=JSON.parse(decodeURIComponent(raw));}catch(_){return '';}value=value.replace(/\{(\d+)\}/g,(_,index)=>resolve(String(args[Number(index)]??''),depth+1));}return value;});}
 function translate(value){if(typeof value==='string')return resolve(value);if(Array.isArray(value))return value.map(translate);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,translate(v)]));return value;}
 async function environment(api){if(!api.host?.environment)return;const env=await api.host.environment();const name=String(env.locale||'').replaceAll('-','_').toLowerCase();const names=Object.keys(catalogs);locale=names.find(key=>key.toLowerCase()===name)||(/^zh_(hant|tw)/i.test(name)?names.find(key=>key==='zh_TW'):undefined)||names.find(key=>key.toLowerCase()===name.split('_')[0])||"zh";}
 function client(api){return {...api,toast:(...args)=>api.toast(...args.map(translate)),dialogs:api.dialogs&&{...api.dialogs,confirm:options=>api.dialogs.confirm(translate(options))},notifications:api.notifications&&{...api.notifications,show:options=>api.notifications.show(translate(options))}};}
 function wrap(ctx){if(typeof ctx.setData!=='function')return {...ctx,api:client(ctx.api)};contexts.set(ctx.surface,ctx);const data=records.get(ctx.surface)||new Map();records.set(ctx.surface,data);ctx.setData('i18n',catalogs[locale]);ctx.setData('pageTitle',data.has('pageTitle')?translate(data.get('pageTitle')):catalogs[locale][titles[ctx.page]]||'');return {...ctx,api:client(ctx.api),setData:(key,value)=>{data.set(key,value);ctx.setData(key,translate(value));}};}
 const fluxdo={...client(host),on:(name,fn)=>host.on(name,async(ctx,args)=>{try{if(ctx.api.host?.environment)await (localeTask??=environment(ctx.api).catch(()=>{}));if(name==='page.resume'||name==='card.resume'){await environment(ctx.api);const source=contexts.get(ctx.surface);if(source)for(const [key,value]of records.get(ctx.surface)||[])source.setData(key,translate(value));}return await fn(wrap(ctx),args);}finally{if(name==='surface.close'){contexts.delete(ctx.surface);records.delete(ctx.surface);}}})};
 // 共享本机便笺：串行写入，输入新版本不会被迟到读取或旧保存覆盖。
const views=new Map();
let note='',revision=0,savedRevision=0,loaded=false,loading=null,saving=null,failed=false,confirming=false;
function render(){
  for(const ctx of views.values()){
    ctx.setData('note',note);
    ctx.setData('count',__text("s22644e8e74fb716c", [Array.from(note).length]));
    ctx.setData('status',failed?__text("s8f52fe1c3c78287d"):!loaded?__text("s2d1341db7717c694"):saving||revision!==savedRevision?__text("s570d6020677958bd"):__text("se5932f66440940a4"));
    ctx.setData('failed',failed);ctx.setData('hasNote',note.length>0);
    ctx.setData('confirming',confirming);
  }
}
async function load(api){
  if(loaded)return;
  if(!loading){
    loading=(async()=>{
      const value=await api.storage.get('note');
      if(revision===0)note=typeof value==='string'?value:'';
      loaded=true;failed=false;
    })().finally(()=>{loading=null;render();});
  }
  return loading;
}
async function save(api){
  if(saving)return saving;
  failed=false;
  saving=(async()=>{
    try{
      await load(api);
      while(savedRevision!==revision){
        const version=revision,value=note;
        await api.storage.set('note',value);
        savedRevision=version;
      }
    }catch(_){failed=true;}
  })().finally(()=>{saving=null;render();if(!failed&&revision!==savedRevision)return save(api);});
  render();
  return saving;
}
function edit(ctx,value){note=String(value??'');revision++;render();return save(ctx.api);}
fluxdo.on('card.load',async ctx=>{
  views.set(ctx.surface,ctx);render();
  try{await load(ctx.api);}catch(_){failed=true;}
  render();
});
fluxdo.on('save',(ctx,args)=>edit(ctx,args.value));
fluxdo.on('retry',ctx=>save(ctx.api));
fluxdo.on('clear',async ctx=>{
  if(confirming||!note)return;
  const version=revision;confirming=true;render();
  try{
    if(!await ctx.api.dialogs.confirm({title:__text("sbbf297d364162c60"),message:__text("s7d301402e595cc87"),confirmLabel:__text("s1ef3de06b32e521b")}))return;
    if(!views.has(ctx.surface))return;
    if(revision!==version){await ctx.api.toast(__text("sd6744af200c1901b"));return;}
    return await edit(ctx,'');
  }finally{confirming=false;render();}
});
fluxdo.on('surface.close',ctx=>{views.delete(ctx.surface);});

 host.on('host.environmentChanged',async ctx=>{await environment(ctx.api);for(const [id,source]of contexts){source.setData('i18n',catalogs[locale]);source.setData('pageTitle',catalogs[locale][titles[source.page]]||'');for(const [key,value]of records.get(id)||[])source.setData(key,translate(value));}});
})(fluxdo);
