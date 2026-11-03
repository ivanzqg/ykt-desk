import { isSea, getAsset } from 'node:sea';
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';

export const packaged = isSea();
// Both app/server.mjs and .build/server.cjs are one directory below the project.
export const projectRoot = packaged
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(process.argv[1]), '..');
export const dataDirectory = process.env.YKT_DATA_DIR
  ? path.resolve(process.env.YKT_DATA_DIR)
  : packaged
    ? path.join(process.platform === 'win32' ? process.env.LOCALAPPDATA || os.homedir() : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'YuketangStudyDesk')
    : path.join(projectRoot, '.local');
export function readPublicAsset(filename) {
  if (!['index.html', 'style.css', 'app.js'].includes(filename)) throw new Error('无效的网页资源');
  return packaged ? Promise.resolve(Buffer.from(getAsset(`public/${filename}`))) : readFile(path.join(projectRoot, 'app/public', filename));
}
