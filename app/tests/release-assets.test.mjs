import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readReleaseAssets,validateReleaseTag} from '../../scripts/release-assets.mjs';

async function fixture(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'ykt-release-'));
  if(path.dirname(path.resolve(directory))!==path.resolve(tmpdir())||!path.basename(directory).startsWith('ykt-release-'))throw new Error('临时Release校验目录超出预期范围');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const version='1.2.1',commit='a'.repeat(40),filename=`YuketangStudyDesk-${version}-chrome.zip`;
  const zip=Buffer.from('fixture ZIP bytes'),sha256=createHash('sha256').update(zip).digest('hex');
  const info={version,filename,commit,type:'chrome-extension',bytes:zip.length,sha256};
  for(const [name,data] of Object.entries({[filename]:zip,[`${filename}.sha256`]:`${sha256}  ${filename}\n`,[`${filename}.build.json`]:JSON.stringify(info),'安装说明.md':'插件安装说明'}))await writeFile(path.join(directory,name),data);
  return {directory,version,commit,filename,info,tag:`v${version}`};
}
test('release publication requires a matching version tag, commit and complete validated asset set',async t=>{
  const f=await fixture(t),prepared=await readReleaseAssets(f);
  assert.equal(prepared.assets.length,4);assert.equal(prepared.filename,f.filename);assert.equal(prepared.sha256,f.info.sha256);
  assert.throws(()=>validateReleaseTag('v1.2.0',f.version),/版本一致/);
  await assert.rejects(readReleaseAssets({...f,commit:'b'.repeat(40)}),/提交不匹配/);
});
test('corrupt or unintended release files fail before publication',async t=>{
  const f=await fixture(t);
  await writeFile(path.join(f.directory,f.filename),'tampered bytes');
  await assert.rejects(readReleaseAssets(f),/校验和/);
  await writeFile(path.join(f.directory,'personal-cache.json'),'{}');
  await assert.rejects(readReleaseAssets(f),/4个发布文件/);
});
