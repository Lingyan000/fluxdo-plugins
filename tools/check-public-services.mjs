import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';

// 仅匿名 GET；此检查不能创建订单、会话或修改服务端数据。
const base='https://api2.ldspro.qzz.io/api/shop';
const evidence=[];
async function read(path){
  const start=performance.now(),response=await fetch(base+path,{signal:AbortSignal.timeout(15000),redirect:'error'});
  evidence.push({path:path.split('?')[0],status:response.status,ms:Math.round(performance.now()-start)});
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
}finally{
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/public-contract.json',JSON.stringify(evidence,null,2)+'\n');
}
