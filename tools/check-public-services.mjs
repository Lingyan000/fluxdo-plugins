import assert from 'node:assert/strict';
import {writeFile,mkdir,appendFile} from 'node:fs/promises';

// 仅匿名 GET；此检查不能创建订单、会话或修改服务端数据。
const base='https://api2.ldspro.qzz.io/api/shop';
const evidence=[];
let outcome='passed',reason='';
class ServiceUnavailable extends Error {}
async function read(path){
  const start=performance.now();let response;
  try{response=await fetch(base+path,{signal:AbortSignal.timeout(15000),redirect:'error'});}
  catch{evidence.push({path:path.split('?')[0],status:null,ms:Math.round(performance.now()-start)});throw new ServiceUnavailable('公开服务网络不可达，未完成接口契约验证');}
  evidence.push({path:path.split('?')[0],status:response.status,ms:Math.round(performance.now()-start)});
  if([401,403,429].includes(response.status)||response.status>=500)throw new ServiceUnavailable('公开服务返回 HTTP '+response.status+'，未完成接口契约验证');
  assert.equal(response.status,200,path);assert.match(response.headers.get('content-type')||'',/json/);
  const json=await response.json();assert.equal(json.success,true);assert.ok(json.data&&typeof json.data==='object');return json.data;
}
try{
  const categories=await read('/categories');assert.ok(Array.isArray(categories.categories));
  const catalog=await read('/products?page=1&pageSize=3');assert.ok(Array.isArray(catalog.products));assert.ok(catalog.pagination);
  for(const summary of catalog.products.slice(0,2)){
    assert.ok(summary.id!=null);const id=encodeURIComponent(summary.id);
    const detail=await read('/products/'+id);assert.equal(String(detail.product?.id),String(summary.id));
    assert.equal(typeof detail.product.name,'string');
    const comments=await read('/products/'+id+'/comments?page=1&pageSize=1');assert.ok(Array.isArray(comments.comments));
  }
  console.log('公开分类、商品、详情和评论契约通过；未使用账号或发送写请求');
}catch(error){
  outcome=error instanceof ServiceUnavailable?'unavailable':'contract_failed';reason=error.message;
  console.error(reason);process.exitCode=1;
}finally{
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/public-contract.json',JSON.stringify({outcome,reason,requests:evidence},null,2)+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'公开服务检查：'+outcome+'\n\n'+(reason||'匿名接口契约通过')+'\n');
}
