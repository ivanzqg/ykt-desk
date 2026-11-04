# 雨课堂学习台

课程与待办管理页面，连接你手动登录的 Chrome，通过雨课堂原有播放器在后台实际播放视频。支持选择校园版或雨课堂版、多选排队、播放中追加任务、同时运行1–16个独立视频会话和静音播放。GitHub Actions 生成 Chrome Manifest V3 插件 ZIP，安装插件不需要 Node.js、本地服务或浏览器调试端口。原 Node 工具保留为可选运行方式。

默认使用“后台播放”，可以切换标签或操作其他窗口。每个视频仍由原播放器加载、解码并发送其正常观看日志；本地工具不生成自制观看心跳，不直接修改完成状态。登录失效、验证码或平台提示需要你手动处理。

## Chrome 插件安装与使用

1. 在 [GitHub Releases](https://github.com/ivanzqg/ykt-desk/releases) 下载 `YuketangStudyDesk-1.2.1-chrome.zip`。也可从 [GitHub Actions](https://github.com/ivanzqg/ykt-desk/actions/workflows/chrome-extension.yml) 的成功运行下载 `yuketang-chrome-*` artifact，解压其中的插件ZIP。
2. 使用 Chrome 118+，打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的目录。
3. 点击工具栏的“雨课堂学习台”打开管理页面，通过“页面版本”选择校园版或雨课堂版，登录后点击“连接浏览器”。登录、连接页和课程接口均使用所选域名；切换版本会断开旧连接，需重新连接、同步。
4. 勾选多个视频，或用“多选全部课程视频”选择当前学期筛选范围中的可播放任务，设置倍速、1–16并发及“视频静音”，点击“加入队列并开始”。超过并发上限的任务会排队，前面的任务完成或跳过后自动补位。
5. 播放过程中可以继续多选，点击“追加”加入当前队列，原并发、倍速和静音设置继续生效。队列显示播放、排队与完成数量。一个队列最多200个视频，重复加入会忽略已有任务；暂停期间追加的任务等待继续。
6. 点击“断开连接”停止队列并关闭插件创建的受控标签。重新打开插件保留课程缓存和任务选择，需重新连接、同步后主动开始。

本地安装目录为 `dist/chrome-extension/unpacked/`。插件通过 `chrome.debugger` 控制自己创建的雨课堂标签，使用 `chrome.storage.local` 保存课程、页面版本和播放计划（含静音选项）。完整权限说明、运行限制和安装步骤见 [Chrome 插件说明](docs/chrome-extension.md)。

## Node 源码启动（可选）

在本目录运行：

```powershell
npm start
```

打开 <http://127.0.0.1:8787>。也可以用 PowerShell 运行 `启动学习台.ps1`。

已打包的 Windows 程序可以双击运行，启动后自动打开网页。点击右上角“退出工具”可以停止服务；关闭网页标签不会停止服务。数据存储在 `%LOCALAPPDATA%\YuketangStudyDesk`，与源码运行的 `.local` 目录隔离。详细说明见 [直接运行版](docs/portable-app.md)。

1. 选择页面版本，点击登录按钮，在新 Chrome 窗口手动登录对应平台。
2. 返回学习台，点击“连接浏览器”。工具同步课程与待办。
3. 选择课程。点击“刷新此课程”可读取完整章节，并展示已完成单元和同名作业所属章节。
4. 勾选未超时的视频，选择倍速、“后台播放”、同时播放数量和是否静音，点击“加入队列并开始”。默认1.5×、同时2段、不静音；可选1×、1.25×、1.5×、2×，同时1–16段。
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
- 同时播放数限制为1–16。每个视频拥有独立播放器；一个任务等待处理时，其他任务可以继续播放。其他手动打开的视频不归本工具控制。16路调度已通过单元测试，实际解码负载与观看完成情况需以本机运行结果为准。
- “视频静音”会在播放前设置播放器静音，插件同时将受控视频标签静音。播放中切换会应用到正在播放和后续排队的视频，暂停/继续保留选择，不改变播放位置或音量数值。
- “页面版本”会保存选择；播放或同步期间需先停止/等待完成再切换。连接页、课程与进度请求、视频和作业都使用所选域名；不会在连接时强制打开校园版。
- 可以跨课程多选、播放中追加任务，并发上限覆盖整个队列。排队任务按加入顺序补位；有登录或播放器提示的任务等待处理，其他活动任务可继续。
- 超时任务仍可查看和打开，但不会加入自动播放，因为截止后的观看通常不会更新最终进度。
- 退出服务会暂停并关闭工具自己的播放会话。重启后恢复未完成任务的选择和播放设置，不自动启动，需重新连接、同步并点击开始。

作业和考试仅展示状态及页面入口，不答题或提交。初次打开时可显示此前核对报告中的缓存，明确标注为上次数据；完成连接和实时同步后才能开始播放。

## Node 工具的数据与运行

`.local/dashboard.json` 保存课程和任务缓存，`.local/playback-plan.json` 保存尚未完成的选择和播放设置（含静音），`.local/preferences.json` 保存页面版本。登录状态由独立 Chrome 配置保存，工具不读取或保存密码和会话 Cookie。活动浏览器连接和播放器实例保存在服务内存中。

后端：`app/server.mjs`；Node 浏览器连接：`app/browser.mjs`；共享播放器与学生接口：`app/browser-core.mjs`；单视频状态：`app/queue.mjs`；并发调度：`app/pool.mjs`；界面：`app/public/`。插件入口为 `extension/service-worker.mjs`，Chrome 适配为 `extension/browser.mjs`。

```powershell
npm test
npm run check
```

当前支持的域名为 `tsinghua.yuketang.cn` 和 `pro.yuketang.cn`。校园版使用学校LMS课程列表及 `xtbz: cloud`；雨课堂版使用原生学生课程列表及 `xtbz: ykt`，从每门课的详情取得SKU、学校和平台上下文。未配置线上单元的课堂仍列出，但显示没有线上任务。接口差异和验证范围见 [平台接口说明](docs/platform-api.md)。

只读平台验证脚本为 `node app/tests/verify-platform-live.mjs`，它创建临时后台页并读取课程列表，不播放视频。此次旧调试Chrome会话在官方原生接口返回HTTP401，真实课程同步还需要使用有效登录验证；这不代表用户其他Chrome配置中的登录状态失效。同步失败会保留缓存、显示接口错误并禁止使用旧任务开始播放。

实际浏览器回归脚本：`node app/tests/verify-background-live.mjs`。它短时播放会计学6067660、6067661两段视频，验证后台并行、暂停/继续和服务器覆盖率后停止。脚本会产生真实观看记录；结果保存到`.local/background-verification.json`，不代表完成整段视频。

## GitHub Actions 与插件打包

`.github/workflows/chrome-extension.yml` 在推送至 `master` / `main`、`v*`版本标签、Pull Request 或手动运行时执行。测试与打包使用Ubuntu和Node.js 24.22.2：

- `verify`：安装锁定的开发依赖，运行语法检查和单元测试。
- `package-extension`：等待校验成功后生成插件ZIP，并验证Manifest、权限、网页资源、JavaScript、ZIP文件清单和SHA-256。
- 上传 `yuketang-chrome-*` artifact，包括插件ZIP、SHA-256、构建信息和安装说明，保留30天。构建信息记录GitHub提交和对应Actions运行地址。
- `release`：只在推送版本标签时运行；等待测试、打包和包校验完成后，将4个发布文件上传至同名Release。先创建草稿，上传全部附件后公开；已公开且内容一致的Release在重跑时保留。

发布版本时，标签必须和 `package.json` 一致，例如当前版本 `1.2.1`：

```powershell
git tag -a v1.2.1 -m "Release v1.2.1"
git push origin v1.2.1
```

版本不匹配时打包失败，不会发布。Release附件长期保留，不受Actions artifact的30天期限限制。Release任务使用仓库自带的 `GITHUB_TOKEN`，只有该任务获得 `contents: write`，无需配置额外密钥。分支推送和Pull Request继续仅测试、打包。

无需自建Windows Runner。CI发布路径限定为 `dist/chrome-extension/` 的指定文件，旧EXE不会被收集。旧 `.gitlab-ci.yml` 保留用于GitLab兼容，但主远程仓库已迁至GitHub。

本地构建：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run build:extension
npm run test:extension
```

输出在 `dist/chrome-extension/`，包含分发 ZIP 和可直接加载的 `unpacked/` 目录。后台通过 esbuild 完整打包，ZIP 仅包含 Manifest、后台脚本、网页资源和安装说明；发布包没有网络捕获、个人课程缓存、Cookie或Chrome配置。`build:exe` 和 `test:exe` 仍可用于手动构建旧独立程序，当前 CI 只发布插件。

服务器部署方案与现有限制见 [部署方案](docs/deployment-plan.md)。主仓库为 [ivanzqg/ykt-desk](https://github.com/ivanzqg/ykt-desk/tree/master)，`origin` 使用 `git@github.com:ivanzqg/ykt-desk.git`；旧GitLab地址保存为 `gitlab` remote。插件包已通过本地校验和单元测试；实际安装后的完整观看进度仍需在Chrome中验证，本地Node服务保持停止。
