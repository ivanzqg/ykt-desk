# 雨课堂学习台：直接运行版

此文档描述保留的 Node SEA 直接运行版。当前 GitLab CI 已改为发布 Chrome 插件，安装插件请阅读 [Chrome 插件说明](chrome-extension.md)。独立程序仅通过 `npm run build:exe` 手动构建。

1. 从本地 `dist/` 取得已手动构建的可执行文件。
2. 双击 `YuketangStudyDesk-1.0.0-windows-x64.exe`，本地网页会自动打开。
3. 点击“打开登录浏览器”，在 Chrome 手动登录雨课堂。
4. 回到学习台连接浏览器，选择课程和任务。

电脑不需要安装 Node.js、npm 或 Python，但需要安装 Google Chrome。程序不内置 Chrome，也不会替你输入密码。

## 停止和数据

点击页面右上角“退出工具”可暂停工具创建的视频、关闭这些播放标签、保存任务选择并停止服务。也可以在程序窗口按 Ctrl+C。关闭网页本身不会停止服务。

程序数据默认保存在 `%LOCALAPPDATA%\YuketangStudyDesk`，其中 `chrome-profile` 是你在此电脑手动登录的独立浏览器配置。升级可执行文件不改变这个数据目录。发布程序不包含开发者的课程、Cookie、浏览器配置或网络捕获。

端口默认8787，只在本机监听。若端口占用，可在 PowerShell 运行：

```powershell
$env:PORT = '8788'
& '.\YuketangStudyDesk-1.0.0-windows-x64.exe'
```

可用 `YKT_DATA_DIR` 设置数据目录，用 `--no-open` 禁止自动打开网页。

## 文件校验

同目录 `.sha256` 文件记录可执行文件 SHA-256，`.build.json` 记录应用版本、Node.js版本和流水线提交。可在 PowerShell 检查：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\YuketangStudyDesk-1.0.0-windows-x64.exe'
```

当前构建产物未做发行商代码签名。组织需要签名分发时，应在流水线中增加组织批准的签名步骤，并在签名后重新生成哈希、执行验收。
