# 机房签到系统

Vue 3 + Electron 的教师端／学生端基础工程。完整技术方案见 [docs/方案.md](docs/方案.md)。学校服务接口字段、部署配置和后端待提供数据见 [docs/后端接口说明.md](docs/后端接口说明.md)。

## 启动

需要 Node.js 22 或更新版本。执行：

```powershell
npm install
npm run dev
```

只预览学生端界面（不需要真实教师机或学生数据）：

```powershell
npm run preview:student
```

该命令会打开全屏、无标题栏的学生页，显示一条临时“预览班级”场次。此预览模式可用 `Alt+F4` 关闭；提交会显示名册接口未接入，不会伪造签到成功。退出应用后，在终端按 `Ctrl+C` 结束预览服务。

如果所在网络无法从 GitHub 下载 Electron 二进制，可按 Electron 官方安装文档在安装前设置镜像：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`。若环境预设了 `ELECTRON_RUN_AS_NODE=1`，启动前执行 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。

首次启动在 Electron 用户数据目录创建 `config.json`，默认教师端，HTTP 服务仅监听本机 `127.0.0.1:41731`。学校名称、Logo 路径、学校服务地址、微信 AppID 和回调地址在此配置；默认地址为空，不含任何学校环境信息。界面底部显示配置文件路径。要在同一台开发机测试学生端，可另建学生端配置文件，设置 `role` 为 `student`、`teacherUrl` 为 `http://127.0.0.1:41731`，并通过 `SIGNIN_CONFIG_PATH` 指向该文件启动第二个进程。实际机房通信必须按方案配置 HTTPS。

部署配置、证书、私钥和签名凭据不要提交到 Git。`.gitignore` 已忽略常见本地配置和密钥文件；校徽可由 `schoolLogoPath` 从安装机器本地加载。当前学校学生名册必须由学校后端提供，应用不会模拟真实签到成功。

按学校品牌生成本地应用图标（需安装 Python Pillow）：

```powershell
python tools/make-icon.py C:\School\config\logo.png
```

生成的图标已加入 `.gitignore`，不会随公开源码提交。

```json
{
  "role": "student",
  "stationId": "PC-01",
  "teacherUrl": "http://127.0.0.1:41731",
  "listenHost": "127.0.0.1",
  "listenPort": 41731
}
```

## 检查

```powershell
npm run typecheck
npm run build
```

后端接入点：`src/main/directory.ts`。API 和界面数据类型：`src/shared/contracts.ts`。页面由 Vue Router 按运行角色路由，跨页面运行状态由 Pinia 管理。教师端使用自绘顶栏承载菜单与窗口控件，顶栏和页面采用同一套蓝灰色设计。

## UI 样式

渲染端已启用 UnoCSS（Wind 3 预设）。主题色和常用快捷类定义在 `uno.config.ts`，Vue 模板中可以直接写原子类，例如 `class="flex items-center gap-3 rounded-xl bg-brand-600 px-5 py-3 text-white"`；也可使用 `btn-primary`、`btn-secondary`、`card-base`、`field-base` 和 `field-label`。分组变体已启用，例如 `class="hover:(bg-brand-700 text-white)"`。学生端启动后静默驻留托盘，教师开启场次时自动弹出无边框 kiosk 全屏，结束场次后自动隐藏回托盘。

## 桌面应用打包

教师端、学生端是两个独立安装包（目前只配置了 Windows）：

```powershell
npm run build:win:teacher
npm run build:win:student
```

安装包分别输出到 `dist/teacher` 和 `dist/student`。两端安装后第一次启动都会写入当前用户的开机启动项，卸载程序不会删除该启动项，可在 Windows「设置 → 应用 → 启动」中手动关闭。

学生端登录系统后在托盘静默运行：

- 托盘图标灰色：连不上教师端；彩色：已连接并等待场次。托盘不提供退出入口，学生无法自行结束程序。
- 教师开始签到场次后自动弹出置顶 kiosk，并拦截关闭、最小化和失焦切走；场次结束后自动隐藏回托盘。

教师端登录系统后正常显示主界面，并常驻托盘：

- 点击窗口关闭按钮只隐藏到托盘，不退出应用，本机签到服务继续运行。
- 托盘菜单提供「显示主界面」和「退出程序」，双击托盘图标或再次运行程序也会唤起主界面。

kiosk 只能阻止普通窗口切换，Windows 系统级操作（Ctrl+Alt+Del、Win 键部分组合、任务管理器结束进程）无法被应用拦截。
