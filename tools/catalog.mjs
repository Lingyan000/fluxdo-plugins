import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maxBundleBytes = 2 * 1024 * 1024;

function https(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.username + url.password + url.hash, '');
  assert.ok(!url.port || url.port === '443');
  return url;
}

export function requiredFeatures(value) {
  assert.ok(value === undefined || (Array.isArray(value) && value.length <= 64));
  for (const name of value ?? []) assert.match(name, /^[a-zA-Z][a-zA-Z0-9]{0,63}$/);
  return [...new Set(value ?? [])].sort();
}

function validateLocales(locales, fields) {
  if(locales===undefined)return;
  assert.ok(locales && typeof locales==='object' && !Array.isArray(locales) && Object.keys(locales).length<=16);
  for(const [locale,values] of Object.entries(locales)){
    assert.match(locale,/^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2}$/);
    assert.ok(values && typeof values==='object' && !Array.isArray(values));
    for(const [key,text] of Object.entries(values))assert.ok(fields[key] && typeof text==='string' && text.trim() && text.length<=fields[key] && !/[\x00-\x1f\x7f]/.test(text),'翻译字段无效');
  }
}

export function validateEntry(entry) {
  validateLocales(entry.locales,{name:100,summary:512,description:65536,changelog:32768});
  assert.match(entry.id, /^[a-z0-9]+([._-][a-z0-9]+)+$/);
  assert.ok(entry.id.length <= 64);
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(entry.version);
  assert.ok(version, '版本须符合 SemVer');
  for (const identifier of version[4]?.split('.') ?? []) {
    assert.ok(!/^0\d+$/.test(identifier), '预发布数字标识不能以零开头');
  }
  const channel=entry.channel??(version[4]?'preview':'stable');
  assert.ok(['stable','preview'].includes(channel));
  assert.ok(channel!=='stable'||!version[4],'测试版本不能声明稳定渠道');
  assert.ok(entry.withdrawn===undefined||typeof entry.withdrawn==='boolean');
  assert.ok(entry.withdrawnVersions===undefined||(Array.isArray(entry.withdrawnVersions)&&entry.withdrawnVersions.length<=128&&entry.withdrawnVersions.every(v=>typeof v==='string'&&/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$/.test(v))));
  assert.ok(entry.reason===undefined||(typeof entry.reason==='string'&&entry.reason.length<=1024));
  assert.ok(Number.isInteger(entry.apiVersion) && entry.apiVersion >= 1);
  for (const [key, max] of Object.entries({ name: 100, author: 100, summary: 512 })) {
    assert.ok(typeof entry[key] === 'string' && entry[key].length > 0 && entry[key].length <= max, key);
  }
  for (const [key, max] of Object.entries({ description: 65536, changelog: 32768 })) {
    assert.ok(entry[key] === undefined || (typeof entry[key] === 'string' && entry[key].length <= max), key);
  }
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  const repo = https(entry.repository);
  assert.equal(repo.hostname, 'github.com');
  assert.match(repo.pathname, /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/);
  const asset = https(entry.packageUrl);
  assert.equal(asset.hostname, 'github.com');
  assert.ok(asset.pathname.startsWith(`${repo.pathname.replace(/\/$/, '')}/releases/download/`));
  assert.ok(asset.pathname.endsWith('.fluxplugin'));
  for (const [key, max] of Object.entries({ categories: 16, screenshots: 8 })) {
    assert.ok(Array.isArray(entry[key] ?? []) && (entry[key] ?? []).length <= max, key);
    assert.ok((entry[key] ?? []).every(value => typeof value === 'string' && value.length <= 4096), key);
  }
  for (const image of entry.screenshots ?? []) https(image);
  assert.ok(entry.icon === undefined || (typeof entry.icon === 'string' && entry.icon.length <= 64));
  requiredFeatures(entry.requiredFeatures);
  return entry;
}

export function validatePackage(bytes, entry) {
  assert.ok(bytes.byteLength <= maxBundleBytes, '插件包过大');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, '摘要不匹配');
  const bundle = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const {manifest,files} = bundle;
  verifyPublisher(bundle);
  assert.equal(manifest.id, entry.id);
  assert.equal(manifest.version, entry.version);
  assert.equal(manifest.apiVersion, entry.apiVersion);
  assert.ok(Number.isInteger(manifest.schema) && manifest.schema >= 8 && manifest.schema <= 12, '不支持的清单版本');
  assert.ok(manifest.apiVersion === 1 || manifest.apiVersion === 2, '不支持的脚本 API 版本');
  if (manifest.apiVersion === 2) {
    assert.ok(manifest.schema >= 9, 'API 2 需要 schema 9 或更高版本');
    assert.equal(manifest.auth, undefined, 'API 2 使用 permissions 声明公共能力');
  }
  const features = requiredFeatures(manifest.requiredFeatures);
  assert.ok((manifest.pages?.length??0)<=(features.includes('extendedPages')?32:16),'页面数量超过已声明能力');
  if(manifest.storage!==undefined){
    const storage=manifest.storage;
    assert.ok(manifest.schema>=12 && manifest.apiVersion===2 && features.includes('storageScopes'));
    assert.ok(storage && typeof storage==='object' && !Array.isArray(storage) && Object.keys(storage).every(k=>['default','scopes'].includes(k)));
    assert.ok(Array.isArray(storage.scopes) && storage.scopes.length>=1 && storage.scopes.length<=2 && new Set(storage.scopes).size===storage.scopes.length);
    assert.ok(storage.scopes.every(s=>['shared','account'].includes(s)) && storage.scopes.includes(storage.default));
    assert.ok(!storage.scopes.includes('account') || manifest.permissions?.identity===true);
  }
  if (features.includes('accountDataMigration')) {
    assert.ok(manifest.permissions?.identity && (manifest.storage ? manifest.storage.scopes.includes('account') : manifest.permissions?.forum?.length ||
      manifest.tasks?.length || manifest.permissions?.notifications || features.includes('navigationBadge')),
    '账号数据迁移需要 identity 和账号分区能力');
  }
  if(manifest.locales!==undefined){
    assert.ok(features.includes('manifestLocalization'),'清单翻译须声明 manifestLocalization');
    const fields={name:40,...(manifest.description!==undefined?{description:200}:{})};
    for(const p of manifest.pages??[]){fields['pages.'+p.id+'.title']=40;if(p.navigation)fields['pages.'+p.id+'.navigation.label']=12;}
    for(const t of manifest.tasks??[])fields['tasks.'+t.id+'.title']=80;
    for(const p of manifest.preferences??[]){fields['preferences.'+p.key+'.title']=80;for(const key of Object.keys(p.options??{}))fields['preferences.'+p.key+'.options.'+key]=80;}
    validateLocales(manifest.locales,fields);
  }
  const permissions = manifest.permissions ?? {};
  if(manifest.dataVersion!==undefined)assert.ok(Number.isInteger(manifest.dataVersion)&&manifest.dataVersion>=1&&manifest.dataVersion<=1000000&&features.includes('dataMigrations'));
  if(manifest.preferences!==undefined){
    assert.ok(features.includes('pluginPreferences')&&Array.isArray(manifest.preferences)&&manifest.preferences.length<=24);
    assert.equal(new Set(manifest.preferences.map(p=>p.key)).size,manifest.preferences.length);
    for(const field of manifest.preferences){
      assert.match(field.key,/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);assert.ok(typeof field.title==='string'&&field.title.trim()&&field.title.length<=80);
      assert.ok(['toggle','text','choice'].includes(field.type));
      if(field.type==='toggle')assert.ok(field.default===undefined||typeof field.default==='boolean');
      else if(field.type==='text')assert.ok(field.default===undefined||(typeof field.default==='string'&&field.default.length<=512));
      else assert.ok(typeof field.default==='string'&&field.options&&Object.hasOwn(field.options,field.default));
    }
  }
  if (manifest.tasks !== undefined || 'background' in permissions || 'notifications' in permissions || features.includes('navigationBadge')) {
    assert.ok(manifest.schema >= 12 && manifest.apiVersion === 2, '任务、通知和角标需要 schema 12 和 API 2');
    for (const name of ['background','notifications']) assert.ok(!(name in permissions) || typeof permissions[name] === 'boolean');
    const tasks = manifest.tasks === undefined ? [] : manifest.tasks;
    assert.ok(Array.isArray(tasks) && tasks.length <= 4);
    assert.equal(new Set(tasks.map(t=>t.id)).size,tasks.length,'任务 ID 重复');
    for(const task of tasks) {
      assert.deepEqual(Object.keys(task).sort(), ['id','title']); assert.match(task.id,/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
      assert.ok(typeof task.title === 'string' && task.title.trim() && task.title.length <= 80);
    }
    assert.ok(!permissions.background || tasks.length, '后台权限需要任务');
    assert.ok(!tasks.length || features.includes('scheduledTasks'), '须声明 scheduledTasks');
    assert.ok(!permissions.notifications || features.includes('localNotifications'), '须声明 localNotifications');
    assert.ok(!features.includes('navigationBadge') || manifest.pages?.some(p=>p.navigation), '角标需要导航页面');
  }
  if (features.length) assert.ok(manifest.schema >= 10, '能力声明需要 schema 10');
  assert.deepEqual(features, requiredFeatures(entry.requiredFeatures), '索引与清单能力声明不一致');
  if (manifest.permissions?.forum !== undefined) {
    assert.ok(manifest.schema >= 11 && manifest.apiVersion === 2, '论坛权限需要 schema 11 和 API 2');
    assert.ok(Array.isArray(manifest.permissions.forum), '论坛权限须为数组');
    if (manifest.permissions.forum.length) assert.ok(features.includes('forumRead'), '须声明 forumRead');
  }
  if (manifest.card?.page !== undefined) {
    assert.ok(features.includes('cardNavigation') && manifest.pages?.some(p=>p.id===manifest.card.page && p.presentation!=='modal'), '卡片入口须引用普通页面并声明 cardNavigation');
  }
  for (const page of manifest.pages ?? []) {
    if (page.appBar !== undefined) {
      assert.ok(features.includes('pageChrome') && page.appBar && typeof page.appBar === 'object' && !Array.isArray(page.appBar), '标题栏须声明 pageChrome');
      assert.ok(Object.keys(page.appBar).length > 0 && Object.entries(page.appBar).every(([key,value]) => ['title','actions'].includes(key) && typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)), '标题栏须引用合法组件');
    }
    if (page.navigation === undefined) continue;
    assert.ok(manifest.schema >= 11 && page.presentation !== 'modal', '导航入口需要 schema 11 的普通页面');
    assert.ok(features.includes('navigationEntries'), '须声明 navigationEntries');
    assert.ok(typeof page.navigation?.label === 'string' && page.navigation.label.trim().length > 0 && page.navigation.label.length <= 12, '导航标签无效');
  }
  assert.ok(Buffer.byteLength(JSON.stringify(manifest)) <= 32 * 1024);
  for (const [key, limit] of [['ui', 256 * 1024], ['script', 512 * 1024]]) {
    const name = manifest[key];
    assert.ok(typeof name === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(name) && !/[?#\\]/.test(name));
    assert.ok(name.split('/').every(part => {
      const decoded = decodeURIComponent(part);
      return decoded && decoded !== '.' && decoded !== '..' && !/[/\\]/.test(decoded);
    }));
    assert.ok(typeof files[name] === 'string' && Buffer.byteLength(files[name]) <= limit);
  }
  new Script(files[manifest.script], { filename: manifest.script });
}

function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  assert.ok(typeof value!=='number'||Number.isSafeInteger(value));return JSON.stringify(value);
}
function verifyPublisher(bundle){
  const publisher=bundle.publisher;if(!publisher)return;
  assert.equal(publisher.algorithm,'RSA-SHA256');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const key=raw=>{const k=createPublicKey({key:raw,format:'jwk'}),bits=k.asymmetricKeyDetails?.modulusLength;
    assert.ok(raw.kty==='RSA'&&raw.e==='AQAB'&&bits>=2048&&bits<=4096);return k;};
  const check=(k,text,signature)=>{assert.ok(typeof signature==='string'&&signature.length<=1024&&/^[A-Za-z0-9_-]+$/.test(signature));
    assert.ok(verify('RSA-SHA256',Buffer.from(text),key(k),Buffer.from(signature,'base64url')),'插件签名无效');};
  const {manifest:m,files:f}=bundle;
  check(publisher.key,'fluxdo-package-v1\n'+hash(canonical(m))+'\n'+hash(f[m.ui])+'\n'+hash(f[m.script])+'\n',publisher.signature);
  if(publisher.rotation)check(publisher.rotation.key,'fluxdo-key-v1\n'+hash(canonical({kty:'RSA',n:publisher.key.n,e:publisher.key.e}))+'\n',publisher.rotation.signature);
}

export function validateRelease(entry, release) {
  const channel=entry.channel??(entry.version.includes('-')?'preview':'stable');
  assert.equal(release.draft, false, '市场不能引用草稿发行版');
  assert.equal(release.prerelease, channel==='preview', 'GitHub 预发布状态与市场渠道不一致');
  assert.ok(release.assets?.some(asset=>asset.browser_download_url===entry.packageUrl), '发行版缺少市场声明的附件');
}

export function validateCatalogTransition(previous, next) {
  const stable = entries => entries.filter(entry =>
    (entry.channel ?? (entry.version.includes('-') ? 'preview' : 'stable')) === 'stable');
  const current = new Set(stable(next.plugins).map(entry => entry.id));
  for (const entry of stable(previous.plugins)) {
    assert.ok(entry.withdrawn || current.has(entry.id),
      `${entry.id} 的正式版条目不能被测试版替换；撤回时保留正式条目并标记 withdrawn`);
  }
}

async function verifyPackage(entry) {
  const url = new URL(entry.packageUrl);
  const parts=url.pathname.split('/');
  const release=await fetch(`https://api.github.com/repos/${parts[1]}/${parts[2]}/releases/tags/${encodeURIComponent(decodeURIComponent(parts[5]))}`, {
    headers:{Accept:'application/vnd.github+json',...(process.env.GITHUB_TOKEN?{Authorization:'Bearer '+process.env.GITHUB_TOKEN}:{})},
    signal:AbortSignal.timeout(30000),
  });
  assert.equal(release.status,200,`${entry.id} 无法核对发行版渠道`);
  validateRelease(entry,await release.json());
  const response = await fetch(entry.packageUrl, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `${entry.id} 下载失败`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    assert.ok(size <= maxBundleBytes, '插件包过大');
    chunks.push(chunk);
  }
  validatePackage(Buffer.concat(chunks), entry);
}

export async function buildCatalog({ check = false, verify = false } = {}) {
  const names = (await readdir(resolve(root, 'entries'))).filter(name => name.endsWith('.json')).sort();
  assert.ok(names.length <= 1000);
  const entries = [];
  for (const name of names) {
    const entry = validateEntry(JSON.parse(await readFile(resolve(root, 'entries', name), 'utf8')));
    const channel=entry.channel??(entry.version.includes('-')?'preview':'stable');
    assert.equal(name, `${entry.id}${channel==='preview'?'.preview':''}.json`);
    assert.ok(!entries.some(previous => previous.id === entry.id && (previous.channel??(previous.version.includes('-')?'preview':'stable'))===channel), '重复插件 ID 与渠道');
    if (verify) await verifyPackage(entry);
    entries.push(entry);
  }
  const output = JSON.stringify({ schemaVersion: 1, name: 'FluxDO 元宇宙市场', plugins: entries }, null, 2) + '\n';
  assert.ok(Buffer.byteLength(output) <= 1024 * 1024);
  const target = resolve(root, 'index.json');
  if (check) assert.equal((await readFile(target, 'utf8')).replaceAll('\r\n', '\n'), output, '请重新生成 index.json');
  else await writeFile(target, output);
  console.log(`已校验 ${entries.length} 个市场条目`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildCatalog({ check: process.argv.includes('--check'), verify: process.argv.includes('--verify-packages') });
}
