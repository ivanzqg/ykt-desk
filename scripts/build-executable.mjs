import {build} from 'esbuild';
import postject from 'postject';
import {mkdir,readFile,writeFile,copyFile,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import { removePeSignature } from './pe-signature.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = path.join(root,'.build');
const outputDirectory = path.join(root,'dist');
const pkg = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('独立程序构建需要 Node.js 24.x，请与 CI 配置保持一致。');
if (!['win32','linux'].includes(process.platform)) throw new Error('此构建脚本目前支持 Windows 和 Linux 原生构建。');
await Promise.all([mkdir(buildDirectory,{recursive:true}),mkdir(outputDirectory,{recursive:true})]);
const bundle = path.join(buildDirectory,'server.cjs');
// Keep identifiers: browser.mjs serializes page functions with Function.toString().
// Minifying them could move helpers outside the serialized page function.
await build({
  entryPoints:[path.join(root,'app/server.mjs')], outfile:bundle, bundle:true,
  platform:'node', format:'cjs', target:'node24', minify:false, sourcemap:false,
  legalComments:'none', packages:'external',
});
const artifactName = `YuketangStudyDesk-${pkg.version}-${process.platform === 'win32' ? 'windows' : 'linux'}-${process.arch}`;
const executable = path.join(outputDirectory, artifactName + (process.platform === 'win32' ? '.exe' : ''));
const blob = path.join(buildDirectory,'sea-prep.blob');
const assets = {};
for (const filename of ['index.html','app.js','style.css']) assets[`public/${filename}`] = path.join(root,'app/public',filename);
const configPath = path.join(buildDirectory,'sea-config.json');
await writeFile(configPath,JSON.stringify({main:bundle,output:blob,disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false,assets},null,2));
const prepare = spawnSync(process.execPath,['--experimental-sea-config',configPath],{cwd:root,stdio:'inherit',windowsHide:true});
if (prepare.status !== 0) throw new Error('生成 Node.js SEA 数据失败');
await copyFile(process.execPath,executable);
if (process.platform === 'win32') await writeFile(executable,removePeSignature(await readFile(executable)));
await postject.inject(executable,'NODE_SEA_BLOB',await readFile(blob),{sentinelFuse:'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'});
if (process.platform !== 'win32') await chmod(executable,0o755);
const binary = await readFile(executable);
const sha256 = createHash('sha256').update(binary).digest('hex');
const info = {
  app:pkg.name,version:pkg.version,node:process.version,platform:process.platform,architecture:process.arch,
  filename:path.basename(executable),bytes:binary.length,sha256,
  commit:process.env.CI_COMMIT_SHA || null,pipeline:process.env.CI_PIPELINE_URL || null,
  createdAt:new Date().toISOString(),embeddedAssets:Object.keys(assets),codeSigned:false,
};
await writeFile(path.join(outputDirectory,`${artifactName}.sha256`),`${sha256}  ${path.basename(executable)}\n`);
await writeFile(path.join(outputDirectory,`${artifactName}.build.json`),JSON.stringify(info,null,2));
await copyFile(path.join(root,'docs/portable-app.md'),path.join(outputDirectory,'使用说明.md'));
console.log(JSON.stringify(info,null,2));
