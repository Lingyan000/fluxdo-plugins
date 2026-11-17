import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

export function validateEntry(entry) {
  assert.match(entry.id, /^[a-z0-9]+([._-][a-z0-9]+)+$/);
  assert.ok(entry.id.length <= 64);
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(entry.version);
  assert.ok(version, '版本须符合 SemVer');
  for (const identifier of version[4]?.split('.') ?? []) {
    assert.ok(!/^0\d+$/.test(identifier), '预发布数字标识不能以零开头');
  }
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
  const { manifest, files } = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.equal(manifest.id, entry.id);
  assert.equal(manifest.version, entry.version);
  assert.equal(manifest.apiVersion, entry.apiVersion);
  assert.ok(manifest.schema >= 8 && manifest.schema <= 11, '不支持的清单版本');
  assert.ok(manifest.apiVersion === 1 || manifest.apiVersion === 2, '不支持的脚本 API 版本');
  if (manifest.apiVersion === 2) {
    assert.ok(manifest.schema >= 9, 'API 2 需要 schema 9 或更高版本');
    assert.equal(manifest.auth, undefined, 'API 2 使用 permissions 声明公共能力');
  }
  const features = requiredFeatures(manifest.requiredFeatures);
  if (features.length) assert.ok(manifest.schema >= 10, '能力声明需要 schema 10');
  assert.deepEqual(features, requiredFeatures(entry.requiredFeatures), '索引与清单能力声明不一致');
  if (manifest.permissions?.forum !== undefined) {
    assert.ok(manifest.schema >= 11 && manifest.apiVersion === 2, '论坛权限需要 schema 11 和 API 2');
    assert.ok(Array.isArray(manifest.permissions.forum), '论坛权限须为数组');
    if (manifest.permissions.forum.length) assert.ok(features.includes('forumRead'), '须声明 forumRead');
  }
  for (const page of manifest.pages ?? []) {
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

async function verifyPackage(entry) {
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
    assert.equal(name, `${entry.id}.json`);
    assert.ok(!entries.some(previous => previous.id === entry.id), '重复插件 ID');
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
