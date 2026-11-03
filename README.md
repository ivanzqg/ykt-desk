# 雨课堂学习台

课程与待办管理页面，连接你手动登录的 Chrome，通过雨课堂原有播放器在后台实际播放视频。支持同时运行1–4个独立视频会话。GitLab CI 现在生成 Chrome Manifest V3 插件 ZIP，安装插件不需要 Node.js、本地服务或浏览器调试端口。原 Node 工具保留为可选运行方式。

默认使用“后台播放”，可以切换标签或操作其他窗口。每个视频仍由原播放器加载、解码并发送其正常观看日志；本地工具不生成自制观看心跳，不直接修改完成状态。登录失效、验证码或平台提示需要你手动处理。

## Chrome 插件安装与使用

1. 下载 GitLab `package_extension` job 的 artifacts，解压其中的 `YuketangStudyDesk-1.0.0-chrome.zip`。
2. 使用 Chrome 118+，打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
3. 点击工具栏的“雨课堂学习台”打开管理页面，在同一个 Chrome 配置中手动登录清华雨课堂，再点击“连接浏览器”。
4. 查看课程和待办，选择视频、倍速和并发数，开始播放。管理页面关闭后队列仍在插件后台运行；Chrome 和电脑需保持运行。
5. 点击“断开连接”停止队列并关闭插件创建的受控标签。重新打开插件保留课程缓存和任务选择，需重新连接、同步后主动开始。

本地安装目录为 `dist/chrome-extension/unpacked/`。插件通过 `chrome.debugger` 控制自己创建的雨课堂标签，使用 `chrome.storage.local` 保存课程和播放计划。当前课程同步以清华雨课堂登录状态为准。完整权限说明、运行限制和安装步骤见 [Chrome 插件说明](docs/chrome-extension.md)。

## Node 源码启动（可选）

在本目录运行：

```powershell
npm start
```

打开 <http://127.0.0.1:8787>。也可以用 PowerShell 运行 `启动学习台.ps1`。

已打包的 Windows 程序可以双击运行，启动后自动打开网页。点击右上角“退出工具”可以停止服务；关闭网页标签不会停止服务。数据存储在 `%LOCALAPPDATA%\YuketangStudyDesk`，与源码运行的 `.local` 目录隔离。详细说明见 [直接运行版](docs/portable-app.md)。

1. 点击“打开登录浏览器”，在新 Chrome 窗口手动登录清华雨课堂。
2. 返回学习台，点击“连接浏览器”。工具同步课程与待办。
3. 选择课程。点击“刷新此课程”可读取完整章节，并展示已完成单元和同名作业所属章节。
4. 勾选未超时的视频，选择倍速、“后台播放”和同时播放数量，点击“开始播放”。默认1.5×、同时2段；可选1×、1.25×、1.5×、2×，同时1–4段。
5. 可以暂停、继续或停止全部视频。队列列表分别显示每段视频的播放位置、服务器覆盖率和状态，并可单独打开、继续或跳过某段视频。

若已启动本项目此前使用的调试浏览器，展开“使用已打开的浏览器”，保留 `http://[::1]:9222` 并连接即可。新登录浏览器使用端口 9333 和 `.local/chrome-profile` 独立配置。

只允许连接本机 Chrome。网页服务绑定 `127.0.0.1`，不对局域网提供访问。若 8787 被占用，可先设置 `$env:PORT = '8788'` 再启动。

## 播放与状态

- 只使用播放器提供的倍速选项；视频未提供所选倍速时等待处理。
- 不跳转到结尾，不上传自制观看心跳，不修改服务器进度。
- “播放位置”反映播放器位置，“服务器观看覆盖率”来自雨课堂学生接口。
- 每段结束后等待服务器明确返回 `completed`，才标记完成并刷新该课程。
- 后台模式对每个独立调试会话启用 Chrome 的 `Emulation.setFocusEmulationEnabled`，让原播放器在后台保持活动；不会反复切换用户正在操作的标签。这里是浏览器焦点仿真，不能理解为用户同时注意多段视频。插件如遇不支持此命令的 Chrome，会提示升级或选择前台模式。
- 开始前读取课程设置。如果平台设置明确禁止同一课程多视频同时播放，工具拒绝该课程的并发启动，需将并发数设为1。
- 前台模式仅支持一段视频。要求窗口焦点的课程在失焦后显示“等待播放页”，返回播放页后保留原位置继续。
- 播放器暂停、网络停滞、登录失效或验证提示时，队列等待手动处理。不会自动完成验证码。
- 同时播放数限制为1–4。每个视频拥有独立播放器；一个任务等待处理时，其他任务可以继续播放。其他手动打开的视频不归本工具控制。
- 超时任务仍可查看和打开，但不会加入自动播放，因为截止后的观看通常不会更新最终进度。
- 退出服务会暂停并关闭工具自己的播放会话。重启后恢复未完成任务的选择和播放设置，不自动启动，需重新连接、同步并点击开始。

作业和考试仅展示状态及页面入口，不答题或提交。初次打开时可显示此前核对报告中的缓存，明确标注为上次数据；完成连接和实时同步后才能开始播放。

## Node 工具的数据与运行

`.local/dashboard.json` 保存课程和任务缓存，`.local/playback-plan.json` 保存尚未完成的选择和播放设置。登录状态由独立 Chrome 配置保存，工具不读取或保存密码和会话 Cookie。活动浏览器连接和播放器实例保存在服务内存中。

后端：`app/server.mjs`；Node 浏览器连接：`app/browser.mjs`；共享播放器与学生接口：`app/browser-core.mjs`；单视频状态：`app/queue.mjs`；并发调度：`app/pool.mjs`；界面：`app/public/`。插件入口为 `extension/service-worker.mjs`，Chrome 适配为 `extension/browser.mjs`。

```powershell
npm test
npm run check
```

当前支持的课程入口是 `tsinghua.yuketang.cn`，机构 ID 为 2598。课程与待办接口来自本目录中已保存的 REA 观察，页面或接口变更时可能需要更新。倍速播放到结束后的服务器确认需以实际课堂配置为准。

实际浏览器回归脚本：`node app/tests/verify-background-live.mjs`。它短时播放会计学6067660、6067661两段视频，验证后台并行、暂停/继续和服务器覆盖率后停止。脚本会产生真实观看记录；结果保存到`.local/background-verification.json`，不代表完成整段视频。

## GitLab CI 与插件打包

`.gitlab-ci.yml` 包含校验和插件打包，两阶段均使用 Linux Docker Runner：

- `verify`：Linux Docker Runner，固定 Node.js 24.22.2，运行语法检查和单元测试。
- `package_extension`：同样使用 Node.js 24.22.2，等待校验成功后生成插件 ZIP，并验证 Manifest、权限、网页资源、JavaScript、ZIP 文件清单和 SHA-256。
- 下载 `package_extension` artifacts，包括插件 ZIP、SHA-256、构建信息和安装说明，保留30天。

无需 Windows Runner。CI 发布路径限定为 `dist/chrome-extension/` 的指定文件，旧 EXE 不会被收集。

本地构建：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build:extension
npm run test:extension
```

输出在 `dist/chrome-extension/`，包含分发 ZIP 和可直接加载的 `unpacked/` 目录。后台通过 esbuild 完整打包，ZIP 仅包含 Manifest、后台脚本、网页资源和安装说明；发布包没有网络捕获、个人课程缓存、Cookie或Chrome配置。`build:exe` 和 `test:exe` 仍可用于手动构建旧独立程序，当前 CI 只发布插件。

服务器部署方案与现有限制见 [部署方案](docs/deployment-plan.md)。项目仓库为 [zhaoqg26/ykt-desk](https://git.tsinghua.edu.cn/zhaoqg26/ykt-desk)，代码提交至 `master`；推送后由 GitLab 根据 `.gitlab-ci.yml` 触发流水线，执行情况见项目的 CI/CD 页面。插件包已通过本地校验和单元测试；实际安装后的后台焦点命令及完整视频观看进度还需在 Chrome 中验证，本地 Node 服务保持停止。
