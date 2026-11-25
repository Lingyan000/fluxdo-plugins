import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {readFileSync} from 'node:fs';
import { validateEntry, validatePackage, validateRelease, validateCatalogTransition } from './catalog.mjs';

const manifest = { schema: 8, apiVersion: 1, id: 'example.plugin', version: '1.0.0', ui: 'ui.rfwtxt', script: 'main.js' };
const bytes = Buffer.from(JSON.stringify({ manifest, files: { 'ui.rfwtxt': 'import fluxdo; widget Card = Gap();', 'main.js': 'fluxdo.on("card.load", () => {});' } }));
const entry = {
  id: manifest.id, version: manifest.version, apiVersion: 1, name: '示例', author: 'example', summary: '示例插件',
  repository: 'https://github.com/example/plugin',
  packageUrl: 'https://github.com/example/plugin/releases/download/v1.0.0/plugin.fluxplugin',
  sha256: createHash('sha256').update(bytes).digest('hex'), categories: [], screenshots: [],
};
test('市场渠道必须与 GitHub 发行版预发布标记一致',()=>{
  const release={draft:false,prerelease:false,assets:[{browser_download_url:entry.packageUrl}]};
  validateRelease(entry,release);
  assert.throws(()=>validateRelease(entry,{...release,prerelease:true}));
  validateRelease({...entry,channel:'preview'},{...release,prerelease:true});
  assert.throws(()=>validateRelease(entry,{...release,draft:true}));
  assert.throws(()=>validateRelease(entry,{...release,assets:[]}));
});
test('发布测试版保留正式条目，撤回需要显式声明', () => {
  const previous = {plugins: [entry]};
  const preview = {...entry, version: '2.0.0', channel: 'preview'};
  validateCatalogTransition(previous, {plugins: [entry, preview]});
  validateCatalogTransition(previous, {plugins: [{...entry, version: '1.1.0'}, preview]});
  assert.throws(() => validateCatalogTransition(previous, {plugins: [preview]}), /正式版条目/);
  assert.throws(() => validateCatalogTransition(previous, {plugins: []}), /正式版条目/);
  validateCatalogTransition(previous, {plugins: [{...entry, withdrawn: true}, preview]});
  validateCatalogTransition({plugins: [{...entry, withdrawn: true}]}, {plugins: [preview]});
  validateCatalogTransition({plugins: [preview]}, {plugins: [preview]});
});
test('校验目录与插件包身份', () => {
  validateEntry(entry);
  validatePackage(bytes, entry);
});

test('市场和清单的本地化只允许显示字段',()=>{
  validateEntry({...entry,locales:{en:{name:'Example',summary:'A plugin'}}});
  for(const locales of [{en:{packageUrl:'https://evil.example'}},{en:{name:'\n'}},{en:['text']}])assert.throws(()=>validateEntry({...entry,locales}));
  const m={...manifest,name:'示例',schema:12,apiVersion:2,requiredFeatures:['manifestLocalization'],locales:{en:{name:'Example'}}};
  function check(manifest){const b=Buffer.from(JSON.stringify({manifest,files:JSON.parse(bytes).files}));validatePackage(b,{...entry,apiVersion:2,requiredFeatures:manifest.requiredFeatures,sha256:createHash('sha256').update(b).digest('hex')});}
  check(m);assert.throws(()=>check({...m,locales:{en:{'permissions.network':'evil.example'}}}));assert.throws(()=>check({...m,requiredFeatures:[]}));
});

test('整卡入口只能引用普通页面且必须声明能力',()=>{
  function check(change={}) {
    const m={...manifest,schema:12,apiVersion:2,requiredFeatures:['cardNavigation'],card:{widget:'Card',page:'home'},pages:[{id:'home',widget:'Home'}],...change};
    const data=Buffer.from(JSON.stringify({manifest:m,files:JSON.parse(bytes).files}));
    validatePackage(data,{...entry,apiVersion:2,requiredFeatures:m.requiredFeatures,sha256:createHash('sha256').update(data).digest('hex')});
  }
  check();
  for(const change of [{requiredFeatures:[]},{card:{widget:'Card',page:'absent'}},{pages:[{id:'home',presentation:'modal'}]}])assert.throws(()=>check(change));
});

test('页面标题栏须声明能力并引用合法组件名', () => {
  function check(change = {}) {
    const m = {...manifest, schema: 12, apiVersion: 2,
      requiredFeatures: ['pageChrome'],
      pages: [{id: 'home', widget: 'Home', appBar: {title: 'PageTitle', actions: 'PageActions'}}],
      ...change};
    const data = Buffer.from(JSON.stringify({manifest: m, files: JSON.parse(bytes).files}));
    validatePackage(data, {...entry, apiVersion: 2, requiredFeatures: m.requiredFeatures,
      sha256: createHash('sha256').update(data).digest('hex')});
  }
  check();
  assert.throws(() => check({requiredFeatures: []}));
  for (const appBar of [{}, [], null, {leading: 'Back'}, {title: ''}, {actions: 'bad-name'}, {title: 1}]) {
    assert.throws(() => check({pages: [{id: 'home', widget: 'Home', appBar}]}));
  }
});

test('实际调度清单与索引一致，拒绝漏报的后台授权和角标',()=>{
  const m=JSON.parse(readFileSync(new URL('../plugins/activity-feed/plugin.json',import.meta.url)));
  const files=Object.fromEntries([m.ui,m.script].map(name=>[name,readFileSync(new URL('../plugins/activity-feed/'+name,import.meta.url),'utf8')]));
  function check(overrides){const manifest={...m,...overrides}, bytes=Buffer.from(JSON.stringify({manifest,files}));validatePackage(bytes,{...manifest,sha256:createHash('sha256').update(bytes).digest('hex')});}
  check({});for(const change of [{schema:11},{tasks:[]},{pages:[]},{tasks:[...m.tasks,...m.tasks]},{requiredFeatures:['forumRead','navigationEntries']}])assert.throws(()=>check(change));
});

test('API 2 使用 schema 9 并拒绝旧授权声明', () => {
  function check(overrides) {
    const updated = { ...manifest, schema: 9, apiVersion: 2, ...overrides };
    const payload = JSON.parse(bytes);
    payload.manifest = updated;
    const encoded = Buffer.from(JSON.stringify(payload));
    validatePackage(encoded, { ...entry, apiVersion: updated.apiVersion,
      sha256: createHash('sha256').update(encoded).digest('hex') });
  }
  check({});
  assert.throws(() => check({schema: 8}));
  assert.throws(() => check({auth: {type: 'token'}}));
  assert.throws(() => check({apiVersion: 3}));
});
test('拒绝摘要或版本不匹配', () => {
  assert.throws(() => validatePackage(bytes, { ...entry, sha256: '0'.repeat(64) }));
  assert.throws(() => validatePackage(bytes, { ...entry, version: '2.0.0' }));
});
test('拒绝仓库外附件及无效目录', () => {
  assert.throws(() => validateEntry({ ...entry, packageUrl: 'https://example.org/plugin.fluxplugin' }));
  assert.throws(() => validateEntry({ ...entry, id: '../plugin' }));
  assert.throws(() => validateEntry({ ...entry, screenshots: ['http://example.org/image.png'] }));
});


test('schema 10 的必需能力必须与市场条目一致', () => {
  const payload=JSON.parse(bytes);
  payload.manifest={...manifest,schema:10,apiVersion:2,requiredFeatures:['virtualGrid','confirmationDialog']};
  const encoded=Buffer.from(JSON.stringify(payload));
  const record={...entry,apiVersion:2,requiredFeatures:['confirmationDialog','virtualGrid'],sha256:createHash('sha256').update(encoded).digest('hex')};
  validateEntry(record);validatePackage(encoded,record);
  assert.throws(()=>validatePackage(encoded,{...record,requiredFeatures:[]}));
  assert.throws(()=>validateEntry({...record,requiredFeatures:['bad.name']}));
});


test('schema 11 的导航和论坛声明与宿主能力一致', () => {
  function check(overrides = {}) {
    const payload = JSON.parse(bytes);
    payload.manifest = {...manifest, schema: 11, apiVersion: 2,
      requiredFeatures: ['forumRead', 'navigationEntries'], permissions: {forum: ['activity']},
      pages: [{id: 'activity', widget: 'Activity', navigation: {label: '动态'}}], ...overrides};
    const encoded = Buffer.from(JSON.stringify(payload));
    validatePackage(encoded, {...entry, apiVersion: payload.manifest.apiVersion,
      requiredFeatures: payload.manifest.requiredFeatures, sha256: createHash('sha256').update(encoded).digest('hex')});
  }
  check();
  assert.throws(() => check({schema: 10}));
  assert.throws(() => check({apiVersion: 1}));
  assert.throws(() => check({requiredFeatures: []}));
  assert.throws(() => check({pages: [{presentation: 'modal', navigation: {label: '动态'}}]}));
  assert.throws(() => check({pages: [{navigation: {label: ''}}]}));
});

test('渠道、撤回字段与签名校验',()=>{
 validateEntry({...entry,channel:'preview',version:'2.0.0-beta.1',withdrawn:true,withdrawnVersions:['1.0.0'],reason:'已撤回'});
 assert.throws(()=>validateEntry({...entry,channel:'stable',version:'2.0.0-beta.1'}));
 assert.throws(()=>validateEntry({...entry,withdrawn:'yes'}));
 const payload=JSON.parse(bytes);payload.publisher={algorithm:'RSA-SHA256',key:{kty:'RSA',n:'bad',e:'AQAB'},signature:'bad'};
 const bad=Buffer.from(JSON.stringify(payload));assert.throws(()=>validatePackage(bad,{...entry,sha256:createHash('sha256').update(bad).digest('hex')}));
});
