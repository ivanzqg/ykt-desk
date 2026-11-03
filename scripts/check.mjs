import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import path from 'node:path';

async function sources(directory) {
  const entries = await readdir(directory, {withFileTypes:true});
  const lists = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sources(path.join(directory, entry.name))
    : /\.(mjs|js)$/.test(entry.name) ? [path.join(directory, entry.name)] : []));
  return lists.flat();
}
for (const file of [...await sources('app'), ...await sources('scripts'), ...await sources('extension')]) {
  const result = spawnSync(process.execPath, ['--check',file], {stdio:'inherit',windowsHide:true});
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('All JavaScript syntax checks passed.');
