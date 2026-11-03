import { unzipSync } from 'fflate';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EXTENSION_FILES, validateManifest } from './extension-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'chrome-extension');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const filename = `YuketangStudyDesk-${pkg.version}-chrome.zip`;
const archive = await readFile(path.join(output, filename));
const files = unzipSync(archive);
assert.deepEqual(Object.keys(files).sort(), [...EXTENSION_FILES].sort(), 'ZIP 只能包含发布文件');
assert.deepEqual((await readdir(path.join(output, 'unpacked'))).sort(), [...EXTENSION_FILES].sort(), '解压安装目录有额外文件');
for (const [name, bytes] of Object.entries(files)) {
  assert.ok(!name.includes('/') && !name.includes('\\') && !name.includes('..'), 'ZIP 存在无效路径');
  assert.deepEqual(Buffer.from(bytes), await readFile(path.join(output, 'unpacked', name)), 'ZIP 和解压文件不一致：'+name);
  if (name.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', path.join(output, 'unpacked', name)], {windowsHide:true, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
}
const text = name => Buffer.from(files[name]).toString('utf8');
const manifest = JSON.parse(text('manifest.json'));
validateManifest(manifest);
assert.equal(manifest.version, pkg.version);
const html = text('index.html');
assert.ok(!html.includes('__LOCAL_TOKEN__') && !html.includes('http://[::1]:9222') && !html.includes('class="advanced"'));
assert.ok(html.includes('断开连接') && html.includes('id="endpoint" type="hidden"'));
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(files[match[1]], '缺少网页资源：'+match[1]);
const worker = text('service-worker.js');
assert.ok(!/\b(?:from\s*['"]node:|require\s*\(|process\.|fetch\(['"]http:\/\/)/.test(worker), '插件后台包含 Node 或本地服务依赖');
assert.ok(worker.includes('Emulation.setFocusEmulationEnabled') && worker.includes('debugger.attach'), '插件缺少浏览器控制');
const sha256 = createHash('sha256').update(archive).digest('hex');
assert.equal((await readFile(path.join(output, filename+'.sha256'), 'utf8')).split(' ')[0], sha256);
const info = JSON.parse(await readFile(path.join(output, filename+'.build.json'), 'utf8'));
assert.equal(info.sha256, sha256);
assert.equal(info.bytes, archive.length);
assert.deepEqual(info.files, EXTENSION_FILES);
console.log(JSON.stringify({filename, bytes:archive.length, sha256, manifestValidated:true, assetsVerified:true, privateDataIncluded:false, browserLiveTest:false}));
