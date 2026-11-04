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

打包教师端首次启动时，如学校服务或微信登录参数尚未填写，会打开设置引导；开发模式优先读取仓库根目录的 `config.local.json`，填好一次后后续启动会直接复用。打包教师端默认监听局域网接口。学生端安装包为一键安装，启动后通过 UDP 41732 自动发现教师端并经内网 HTTP 通信，无需逐台改配置。签到时自动上报 Windows 电脑名称。教师端防火墙应只允许机房网段访问。

开发时可将 [config.local.example.json](config.local.example.json) 复制为根目录的 `config.local.json`，填写本机配置后运行 `npm run dev`。开发程序会自动读取该文件；文件已被 `.gitignore` 排除，不会提交到 Git。也可把配置放在项目目录之外，并通过 `SIGNIN_CONFIG_PATH` 指定完整路径。已打包应用不读取项目目录配置，继续使用 Electron 用户数据目录中的 `config.json`。

学校名称、服务地址、微信登录和机房端口可在教师端首次启动引导页或「设置」中填写，保存后应用会重启。项目内置原版学校 Logo，也可在设置页选择其他图片。当前学校学生名册必须由学校后端提供，应用不会模拟真实签到成功。

### 教师端签到历史

结束场次时，教师端会把该场次的班级、开始和结束时间、完整学生名单及考勤状态写入本机用户数据目录的 `attendance.sqlite`。旧版状态文件里最后一个已结束场次会在升级后首次启动时自动迁入，之后只保留正在进行的场次状态。学生端不保存历史数据。

在「签到记录」切换到「历史场次」，可按开始日期、结束日期及班级、学生或电脑名称查询。选中场次后可修改班级名称、学生考勤状态、签到时间和电脑名称，也可删除单条学生记录或整场记录。删除学生记录会减少该场应到人数；误记为已签到时，建议改为「未签到」以保留名单。点击「导出 Excel」可将所选场次完整明细保存为 `.xlsx` 文件。备份教师机时请一并备份该 SQLite 文件。

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
