export const EXTENSION_FILES = ['manifest.json', 'service-worker.js', 'index.html', 'app.js', 'style.css', '安装说明.md'];
export function validateManifest(manifest) {
  if (manifest.manifest_version !== 3 || manifest.minimum_chrome_version !== '118') throw new Error('插件需要 Manifest V3 和 Chrome 118+');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) throw new Error('插件版本必须符合 Chrome 格式');
  const permissions = [...manifest.permissions].sort();
  if (JSON.stringify(permissions) !== JSON.stringify(['debugger','storage','tabs'])) throw new Error('插件权限与预期不符');
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://tsinghua.yuketang.cn/*','https://pro.yuketang.cn/*'])) throw new Error('插件仅允许两个雨课堂域名');
  if (manifest.background?.service_worker !== 'service-worker.js' || manifest.background?.type !== 'module') throw new Error('插件后台入口无效');
  for (const key of ['externally_connectable','web_accessible_resources','content_scripts','update_url']) if (key in manifest) throw new Error('插件包含未预期的外部入口：'+key);
  if (manifest.content_security_policy?.extension_pages?.includes('unsafe-eval')) throw new Error('插件页面不能启用 unsafe-eval');
}
