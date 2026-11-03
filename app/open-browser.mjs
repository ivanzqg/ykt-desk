import { spawn } from 'node:child_process';

export async function openDashboard(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('只能打开本地学习台');
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', parsed.href]]
    : process.platform === 'darwin' ? ['open', [parsed.href]] : ['xdg-open', [parsed.href]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
