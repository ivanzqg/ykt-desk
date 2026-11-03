import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EXTENSION_FILES, validateManifest } from './extension-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'chrome-extension');
const unpacked = path.join(output, 'unpacked');
await mkdir(unpacked, {recursive:true});
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
validateManifest(manifest);
// Page functions are serialized with Function.toString(); keep their own local names.
const result = await build({
  entryPoints:[path.join(root, 'extension', 'service-worker.mjs')],
  outfile:'service-worker.js', write:false, bundle:true, format:'esm', platform:'browser',
  target:'chrome118', minify:false, sourcemap:false, legalComments:'none', metafile:true,
});
if (Object.values(result.metafile.outputs).some(o => o.imports.length)) throw new Error('插件后台必须完全打包');
let html = await readFile(path.join(root, 'app/public/index.html'), 'utf8');
html = html.replace(/\s*<meta name="local-token"[^>]+>/,'')
  .replace('href="/style.css"', 'href="style.css"').replace('src="/app.js"', 'src="app.js"')
  .replace('href="/"', 'href="index.html"')
  .replace(/<details class="advanced">[\s\S]*?<\/details>/, '<input id="endpoint" type="hidden" value="">')
  .replace('打开登录浏览器','打开雨课堂登录页').replace('退出工具','断开连接')
  .replace('本地学习工具','Chrome 学习插件')
  .replace('在 Chrome 中手动登录，然后连接学习台。','选择页面版本，在当前 Chrome 中手动登录后连接学习台。')
  .replace('只在本机运行 · 手动登录','Chrome 插件 · 手动登录');
const instructions = Buffer.from((await readFile(path.join(root, 'docs/chrome-extension.md'),'utf8'))
  .replace('(platform-api.md)','(https://github.com/ivanzqg/ykt-desk/blob/master/docs/platform-api.md)'));
const files = {
  'manifest.json':Buffer.from(JSON.stringify(manifest, null, 2)+'\n'),
  'service-worker.js':result.outputFiles[0].contents,
  'index.html':Buffer.from(html),
  'app.js':await readFile(path.join(root, 'app/public/app.js')),
  'style.css':await readFile(path.join(root, 'app/public/style.css')),
  '安装说明.md':instructions,
};
if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify([...EXTENSION_FILES].sort())) throw new Error('发布文件清单不匹配');
for (const [filename, content] of Object.entries(files)) await writeFile(path.join(unpacked, filename), content);
const filename = `YuketangStudyDesk-${pkg.version}-chrome.zip`;
const archive = zipSync(files, {level:9, mtime:new Date('2020-01-01T00:00:00Z')});
await writeFile(path.join(output, filename), archive);
const sha256 = createHash('sha256').update(archive).digest('hex');
const info = {
  app:pkg.name, version:pkg.version, type:'chrome-extension', manifestVersion:3,
  minimumChromeVersion:manifest.minimum_chrome_version, filename, bytes:archive.length, sha256,
  node:process.version, commit:process.env.CI_COMMIT_SHA || null,
  pipeline:process.env.CI_PIPELINE_URL || null, createdAt:new Date().toISOString(), files:EXTENSION_FILES,
};
await writeFile(path.join(output, filename+'.sha256'), `${sha256}  ${filename}\n`);
await writeFile(path.join(output, filename+'.build.json'), JSON.stringify(info, null, 2)+'\n');
await writeFile(path.join(output, '安装说明.md'), instructions);
console.log(JSON.stringify(info, null, 2));
