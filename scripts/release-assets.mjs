import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export function validateReleaseTag(tag,version) {
  if(tag!==`v${version}`)throw new Error(`Release 标签必须与 package.json 版本一致：应为 v${version}，实际为 ${tag}`);
}
export function releaseAssetNames(name) {
  // GitHub sanitizes non-ASCII upload names; use ASCII for new release assets.
  return name==='安装说明.md' ? ['INSTALL.md','default.md','安装说明.md'] : [name];
}

export async function readReleaseAssets({directory,tag,version,commit}) {
  validateReleaseTag(tag,version);
  const filename=`YuketangStudyDesk-${version}-chrome.zip`;
  const names=[filename,`${filename}.sha256`,`${filename}.build.json`,'安装说明.md'];
  const actual=await readdir(directory);
  if(JSON.stringify(actual.sort())!==JSON.stringify([...names].sort()))throw new Error('Release 下载目录必须仅包含当前版本的4个发布文件');
  const assets=await Promise.all(names.map(async name=>({name,data:await readFile(path.join(directory,name))})));
  if(assets.some(asset=>!asset.data.length))throw new Error('Release 文件不能为空');
  const sha256=createHash('sha256').update(assets[0].data).digest('hex');
  const checksum=assets[1].data.toString('utf8').trim();
  const info=JSON.parse(assets[2].data.toString('utf8'));
  if(checksum!==`${sha256}  ${filename}`||info.sha256!==sha256||info.bytes!==assets[0].data.length)throw new Error('Release 插件ZIP与校验和或构建信息不一致');
  if(info.version!==version||info.filename!==filename||info.type!=='chrome-extension'||info.commit!==commit)throw new Error('Release 构建版本或提交不匹配');
  return {assets,filename,sha256};
}
