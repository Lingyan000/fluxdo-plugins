// 共享本机便笺：串行写入，输入新版本不会被迟到读取或旧保存覆盖。
const views=new Map();
let note='',revision=0,savedRevision=0,loaded=false,loading=null,saving=null,failed=false,confirming=false;
function render(){
  for(const ctx of views.values()){
    ctx.setData('note',note);
    ctx.setData('count',`${Array.from(note).length} 字`);
    ctx.setData('status',failed?'保存未完成':!loaded?'正在读取':saving||revision!==savedRevision?'正在保存':'已自动保存');
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
    if(!await ctx.api.dialogs.confirm({title:'清空随手记',message:'清空后无法恢复，是否继续？',confirmLabel:'清空'}))return;
    if(!views.has(ctx.surface))return;
    if(revision!==version){await ctx.api.toast('内容已更新，请重新确认清空。');return;}
    return await edit(ctx,'');
  }finally{confirming=false;render();}
});
fluxdo.on('surface.close',ctx=>{views.delete(ctx.surface);});
