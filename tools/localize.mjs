import {parse} from 'acorn';
import {createHash} from 'node:crypto';
import {Converter} from 'opencc-js';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

// 只标记源码中的产品文案，服务器返回的标题、正文、用户名不参与翻译。
for(const id of ['activity-feed','ld-store']){
  const dir=new URL('../plugins/'+id+'/',import.meta.url);
  const source=readFileSync(new URL('src/main.js',dir),'utf8');
  const ui=readFileSync(new URL('src/ui.rfwtxt',dir),'utf8');
  const manifest=JSON.parse(readFileSync(new URL('plugin.json',dir)));
  const english=JSON.parse(readFileSync(new URL('locales/en.json',dir)));
  const keys=new Map(),strings=[];
  function key(text){if(!keys.has(text)){keys.set(text,'s'+createHash('sha256').update(text).digest('hex').slice(0,16));strings.push(text);}return keys.get(text);}
  function transform(node){
    if(node.type==='Literal'&&typeof node.value==='string'&&/[\u3400-\u9fff]/.test(node.value)){
      return '__text('+JSON.stringify(key(node.value))+')';
    }
    if(node.type==='TemplateLiteral'&&node.quasis.some(q=>/[\u3400-\u9fff]/.test(q.value.cooked))){
      const parts=node.quasis.map((q,i)=>q.value.cooked+(i<node.expressions.length?'{'+i+'}':''));
      // 模板参数保持原样，由显示时展开，内容不会二次当作语言键处理。
      return '__text('+JSON.stringify(key(parts.join('')))+', ['+node.expressions.map(transform).join(', ')+'])';
    }
    const children=Object.values(node).flatMap(child=>Array.isArray(child)?child.filter(x=>x?.type):child?.type?[child]:[]);
    let text=source.slice(node.start,node.end);
    for(const child of children.sort((a,b)=>b.start-a.start))text=text.slice(0,child.start-node.start)+transform(child)+text.slice(child.end-node.start);
    return text;
  }
  const code=transform(parse(source,{ecmaVersion:'latest'}));
  let outputUi=ui.replace(/"([^"\n]*[\u3400-\u9fff][^"\n]*)"/g,(_,text)=>'data.i18n.'+key(text));
  const titles=Object.fromEntries(manifest.pages.map(p=>[p.id,key(p.title)]));
  for(const text of strings)if(typeof english[text]!=='string'||!english[text])throw Error(id+' 缺少英文文案：'+text);
  const tw=Converter({from:'cn',to:'twp'}),hk=Converter({from:'cn',to:'hk'});
  const catalogs=Object.fromEntries([['zh',x=>x],['en',x=>english[x]],['zh_TW',tw],['zh_HK',hk]].map(([locale,convert])=>[locale,Object.fromEntries(strings.map(x=>[keys.get(x),convert(x)]))]));
  const runtime=`// 此文件由 tools/localize.mjs 生成，业务源码与翻译见 src/、locales/。
((host)=>{
 const catalogs=${JSON.stringify(catalogs)},titles=${JSON.stringify(titles)};
 let locale='zh',localeTask=null;const contexts=new Map(),records=new Map();
 // 文案标记只用于显示，稳定键可随缓存跨版本保留。
 const prefix='\\uE000fluxdo-text:',suffix='\\uE001';
 function __text(key,args=[]){return prefix+key+(args.length?':'+encodeURIComponent(JSON.stringify(args)):'')+suffix;}
 function resolve(text,depth=0){if(typeof text!=='string'||depth>4)return text;return text.replace(/\\uE000fluxdo-text:([a-z0-9]+)(?::([^\\uE001]*))?\\uE001/g,(_,key,raw)=>{let value=catalogs[locale][key]||catalogs.zh[key]||'';if(raw){let args;try{args=JSON.parse(decodeURIComponent(raw));}catch(_){return '';}value=value.replace(/\\{(\\d+)\\}/g,(_,index)=>resolve(String(args[Number(index)]??''),depth+1));}return value;});}
 function translate(value){if(typeof value==='string')return resolve(value);if(Array.isArray(value))return value.map(translate);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,translate(v)]));return value;}
 async function environment(api){if(!api.host?.environment)return;const env=await api.host.environment();const name=String(env.locale||'zh').replaceAll('-','_');locale=/^en/i.test(name)?'en':/^(zh_(HK|MO)|zh_Hant_HK)/i.test(name)?'zh_HK':/^zh_(TW|Hant)/i.test(name)?'zh_TW':'zh';}
 function client(api){return {...api,toast:(...args)=>api.toast(...args.map(translate)),dialogs:api.dialogs&&{...api.dialogs,confirm:options=>api.dialogs.confirm(translate(options))},notifications:api.notifications&&{...api.notifications,show:options=>api.notifications.show(translate(options))}};}
 function wrap(ctx){if(typeof ctx.setData!=='function')return {...ctx,api:client(ctx.api)};contexts.set(ctx.surface,ctx);const data=records.get(ctx.surface)||new Map();records.set(ctx.surface,data);ctx.setData('i18n',catalogs[locale]);ctx.setData('pageTitle',data.has('pageTitle')?translate(data.get('pageTitle')):catalogs[locale][titles[ctx.page]]||'');return {...ctx,api:client(ctx.api),setData:(key,value)=>{data.set(key,value);ctx.setData(key,translate(value));}};}
 const fluxdo={...client(host),on:(name,fn)=>host.on(name,async(ctx,args)=>{try{if(ctx.api.host?.environment)await (localeTask??=environment(ctx.api).catch(()=>{}));if(name==='page.resume'||name==='card.resume'){await environment(ctx.api);const source=contexts.get(ctx.surface);if(source)for(const [key,value]of records.get(ctx.surface)||[])source.setData(key,translate(value));}return await fn(wrap(ctx),args);}finally{if(name==='surface.close'){contexts.delete(ctx.surface);records.delete(ctx.surface);}}})};
 ${code}
 host.on('host.environmentChanged',async ctx=>{await environment(ctx.api);for(const [id,source]of contexts){source.setData('i18n',catalogs[locale]);source.setData('pageTitle',catalogs[locale][titles[source.page]]||'');for(const [key,value]of records.get(id)||[])source.setData(key,translate(value));}});
})(fluxdo);
`;
  outputUi+='\nwidget LocalizedTitle = Label(text: data.pageTitle, style: "titleLarge", maxLines: 1);\n';
  for(const page of manifest.pages)page.appBar={...page.appBar,title:'LocalizedTitle'};
  for(const feature of ['hostEnvironment','pageChrome'])if(!manifest.requiredFeatures.includes(feature))manifest.requiredFeatures.push(feature);
  if(process.argv.includes('--check')){
    if(readFileSync(new URL('main.js',dir),'utf8')!==runtime||readFileSync(new URL('ui.rfwtxt',dir),'utf8')!==outputUi||readFileSync(new URL('locales/catalogs.json',dir),'utf8')!==JSON.stringify(catalogs,null,2)+'\n'||readFileSync(new URL('plugin.json',dir),'utf8')!==JSON.stringify(manifest,null,2)+'\n')throw Error(id+' 本地化产物需要更新');
  }else{
    writeFileSync(new URL('locales/catalogs.json',dir),JSON.stringify(catalogs,null,2)+'\n');writeFileSync(new URL('main.js',dir),runtime);writeFileSync(new URL('ui.rfwtxt',dir),outputUi);writeFileSync(new URL('plugin.json',dir),JSON.stringify(manifest,null,2)+'\n');
  }
  console.log(id+': '+strings.length+' 条文案，4 种语言');
}
