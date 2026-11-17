import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { validateEntry, validatePackage } from './catalog.mjs';

const manifest = { schema: 8, apiVersion: 1, id: 'example.plugin', version: '1.0.0', ui: 'ui.rfwtxt', script: 'main.js' };
const bytes = Buffer.from(JSON.stringify({ manifest, files: { 'ui.rfwtxt': 'import fluxdo; widget Card = Gap();', 'main.js': 'fluxdo.on("card.load", () => {});' } }));
const entry = {
  id: manifest.id, version: manifest.version, apiVersion: 1, name: '示例', author: 'example', summary: '示例插件',
  repository: 'https://github.com/example/plugin',
  packageUrl: 'https://github.com/example/plugin/releases/download/v1.0.0/plugin.fluxplugin',
  sha256: createHash('sha256').update(bytes).digest('hex'), categories: [], screenshots: [],
};
test('校验目录与插件包身份', () => {
  validateEntry(entry);
  validatePackage(bytes, entry);
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
