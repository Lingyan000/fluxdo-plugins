import assert from 'node:assert/strict';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePackage } from './catalog.mjs';

const [input, output] = process.argv.slice(2);
assert.ok(input && output, '用法 node tools/package.mjs <插件目录> <输出.fluxplugin>');
const root = await realpath(input);
const manifest = JSON.parse(await readFile(resolve(root, 'plugin.json'), 'utf8'));
const files = {};
for (const key of ['ui', 'script']) {
  const resource = manifest[key];
  assert.ok(typeof resource === 'string' && !/[:?#\\]/.test(resource));
  const target = await realpath(resolve(root, resource));
  const within = relative(root, target);
  assert.ok(within && !within.startsWith('..') && !isAbsolute(within), '资源必须位于插件目录内');
  files[resource] = await readFile(target, 'utf8');
}
const bytes = Buffer.from(JSON.stringify({ manifest, files }));
const sha256 = createHash('sha256').update(bytes).digest('hex');
validatePackage(bytes, { id: manifest.id, version: manifest.version, apiVersion: manifest.apiVersion, sha256 });
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, bytes);
console.log(JSON.stringify({ id: manifest.id, version: manifest.version, apiVersion: manifest.apiVersion, sha256, file: output }, null, 2));
