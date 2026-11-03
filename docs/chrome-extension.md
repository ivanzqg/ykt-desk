# 雨课堂学习台 Chrome 插件

GitHub Actions 的发布产物为 Manifest V3 Chrome 插件 ZIP。插件包含课程与待办管理页面，直接使用当前 Chrome 中手动登录的雨课堂，不需要 Node.js、本地服务或 Chrome 调试端口。

## 安装

1. 在 [GitHub Actions](https://github.com/ivanzqg/ykt-desk/actions/workflows/chrome-extension.yml) 打开成功的运行，下载 `yuketang-chrome-*` artifact，找到 `YuketangStudyDesk-1.2.0-chrome.zip`。
2. 将插件 ZIP 解压到固定目录。目录中必须直接包含 `manifest.json`，不要选择 artifacts 外层目录。
3. 使用 Chrome 118 或更高版本，打开 `chrome://extensions`，启用右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
5. 点击工具栏扩展程序菜单中的“雨课堂学习台”，打开管理页面。可以将插件固定到工具栏。

本地构建后可直接加载 `dist/chrome-extension/unpacked/`。Chrome 不会将下载的 ZIP 直接安装为扩展；ZIP 用于分发和解压安装。若 Chrome 受组织策略限制开发者模式，需要通过组织管理分发或 Chrome Web Store 安装。

从旧版本升级时，先断开当前播放，再将新版解压到原安装目录，在 `chrome://extensions` 点击插件的“重新加载”。页面版本及播放计划存储在 Chrome 中，会保留；请重新打开学习台、连接并同步课程后开始。

## 使用

1. 在“页面版本”选择“校园版”或“雨课堂版”，点击对应登录按钮，手动登录。校园版使用 `https://tsinghua.yuketang.cn/pro/`，雨课堂版使用 `https://pro.yuketang.cn/v2/web`。
2. 返回学习台，点击“连接浏览器”。插件创建所选版本的后台数据标签，在同一域名读取课程与待办，不再固定打开校园版。
3. 选择课程、刷新章节，或按视频、作业、截止时间筛选待办。
4. 多选未完成且未超时的视频，或点击“多选全部课程视频”（跟随当前学期/全部学期筛选），设置倍速、播放方式、同时播放数量及“视频静音”，点击“加入队列并开始”。后台模式支持1–16个独立视频标签，默认2个；前台模式为1个。其余任务排队，按加入顺序自动补位。
5. 播放期间可继续多选并点击“追加”，原并发上限始终生效。一个队列最多200个视频，已有任务不会重复加入；暂停时追加等待继续。队列显示播放、排队与完成数量，也能查看每段的播放位置与服务器覆盖率。
6. 点击“断开连接”暂停并关闭插件创建的受控标签。学习台可以再次连接。关闭管理页面不会停止正在运行的播放队列。

Chrome 必须保持运行，电脑必须保持唤醒。关闭 Chrome、系统睡眠、登录失效、验证码或调试连接被取消，都会中断任务。恢复后需要重新连接、同步并主动开始；插件只恢复缓存与任务选择，不自动重新播放。

页面版本会保存，并控制登录页、连接页、课程请求、视频、作业和课程入口的域名；学习单元ID和章节参数保持对应。接口保留机构2598、平台3上下文。切换版本会断开旧连接并将旧课程数据标记为缓存，需重新连接、同步后开始；播放和同步期间不能切换。接口登录失效或返回错误时显示提示，不会自动回到校园版。

只读实测确认连接页分别位于两个域名。此次旧浏览器会话均返回登录错误，真实课程列表和完整视频观看进度仍需用有效登录验证。

静音同时作用于原视频元素和插件创建的视频标签，避免自动播放或播放器重载时发出声音。修改静音会应用到所有活动视频和后续任务，暂停/继续保留选择，停止后计划仍保存静音值。16路调度已通过单元测试；16段实际媒体解码及完整视频完成尚未压测，CPU、内存和带宽用量会随并发数增加。

## 权限与播放方式

插件使用 `debugger`、`tabs`、`storage` 权限。Chrome 可能显示“正在调试浏览器”的提示；取消调试或打开受控标签的开发者工具可能断开连接，插件会停止当前队列。调试仅针对插件创建的雨课堂数据和播放标签，手动登录页及其他浏览器标签不受控。

`debugger` 调用 `Runtime`、`Input` 和 `Emulation` 控制原播放器。后台模式使用 `Emulation.setFocusEmulationEnabled`；如果当前 Chrome 不支持此命令，显示错误并关闭该播放标签，可切换前台模式。Chrome 118+ 的活动 debugger 会话可保持 Manifest V3 后台 service worker 运行，因此无需额外 Node 服务或常驻管理页面。

视频仍由雨课堂原播放器实际下载、解码和上报观看记录；完成状态只在服务器返回明确的 `completed` 后更新。课程明确禁止多视频同时播放时，不能启动同课程并发。作业与练习展示状态和页面入口。

课程缓存、页面版本与播放计划（含静音）保存在 `chrome.storage.local`，受控标签记录保存在 `chrome.storage.session`。插件通过页面自身发起学生接口请求，未请求 Cookie 权限，不读取、导出或保存会话 Cookie 和密码。插件更新保留缓存；卸载插件会删除其本地存储。

## GitHub Actions

`.github/workflows/chrome-extension.yml` 在推送至master/main、Pull Request及手动运行时执行，两阶段均使用Ubuntu和Node.js 24.22.2：

- `verify`：`npm ci`、语法检查、单元测试。
- `package-extension`：`npm ci`、`npm run build:extension`、`npm run test:extension`，然后上传artifact。

发布 artifacts 包含插件 ZIP、SHA-256、构建信息和安装说明，保留 30 天。只收集 `dist/chrome-extension/` 的指定文件，不上传旧 EXE、课程缓存、浏览器配置和网络捕获。

本地构建与校验：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build:extension
npm run test:extension
```

包校验检查 Manifest、权限、网页资源、JavaScript 语法、发布文件清单和 ZIP 校验和；单元测试覆盖并发调度、Chrome 调试适配、失联清理和后台消息入口。CI 不会登录个人账号或播放课程视频。插件实际在用户 Chrome 中安装后，仍需验证后台焦点命令、登录及服务器进度；原 Node 工具的浏览器验证结果不能代替插件实测。
