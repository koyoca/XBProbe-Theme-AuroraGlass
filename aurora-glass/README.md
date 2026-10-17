# Aurora Glass · 极光琉璃

XB-Probe（小白探针）的**外部公开看板主题**：极光渐变背景 + 毛玻璃卡片。

> 本主题是 [XBProbe-Theme](https://github.com/koyoca/XBProbe-Theme) 仓库里的一个目录
> （`aurora-glass/`，**目录名即主题名**），不依赖 XB-Probe 的任何构建步骤。
> 安装最省事的是下载 Release 里的 `aurora-glass.zip`，在后台「系统 → 主题」上传；
> 也可以把本目录拷进 XB-Probe 的 `themes_dir`。详见下面「安装」一节。

```
aurora-glass/
├── theme.json      主题元数据（名称/版本/入口/说明）
├── index.html      入口页（结构）
├── style.css       全部样式（设计令牌 + 组件）
├── app.js          全部脚本（取数 / 渲染 / Canvas 图表）
├── favicon.svg     站点图标
├── preview.png     预览图（仓库展示用）
└── README.md       本文件
```

## 设计语言

主题围绕四条主张展开，全部落在 XB-Probe 的原生前端约束
（零外部依赖、CSP `default-src 'self'`）之内：

| 设计要素 | 实现 |
|---|---|
| 毛玻璃材质：半透明面 + `backdrop-filter: blur + saturate` + 1px 亮边 + 内侧高光 | `--glass / --glass-border / --glass-inset` 三件套，全部容器通用 |
| 极光背景透过玻璃呈色 | 四团 CSS 径向渐变光斑缓慢漂移（青/靛/品红/金），`prefers-reduced-motion` 时静止 |
| 卡片大圆角 + 柔和投影托离纸面 | `--radius: 16px`，`--glass-shadow` 双层柔影；hover 抬升一档 |
| **节点卡片：2×2 指标格**（CPU/内存/磁盘/流量各占一格，格内标签+数值+进度条+说明） | `.n-tiles` + `.tile`，四格自动排布；某格被后台关闭时余下奇数格自动铺满整行 |
| 指标按用量分档着色（绿→琥珀→玫红），而非单色 | `.bar i.warn / .bad` 与 `.tile.warn / .bad`，分档阈值 75% / 90% |
| 延迟点阵：每条目标一行，色段表达严重度 | `.strip` + `.seg`，五档色阶（≤50 / ≤100 / ≤200 / ≤500 / >500 ms），丢包独立一行 |
| 顶部状态点 + 名称 + 状态胶囊 | `.n-head`：呼吸态在线点（唯一带光环的元素）、国旗、状态胶囊按状态着色 |
| 顶栏吸顶 + 毛玻璃 + 渐变标题 | `.topbar` + `.site-title` 渐变色文字 |
| 彩色分级进度条 + 彩色图表 | 每条指标一个色相（青/紫/琥珀/翠/玫红），图表按指标取色、延迟按序号取极光色相 + 虚线 |

实现说明：

1. 所有 DOM 由 `app.js` 用 `textContent` 手工构建——CSP 下不允许内联脚本，
   也符合平台"渲染不可信字符串一律 textContent"的约定。
2. 公开 API 不含坐标数据，因此不引入任何地理组件，版面全部让给指标与曲线。

## 安装（导入 XB-Probe）

三种方式任选：**后台上传主题包**最省事（XB-Probe 0.3.1 起支持，无需 SSH）；
其余两种适合没有后台权限、或想直接用 git 跟版本的场景。

### 方式 A：后台上传主题包（推荐）

1. 下载 [aurora-glass.zip](https://github.com/koyoca/XBProbe-Theme/releases/download/aurora-glass-v1.1.0/aurora-glass.zip)，
   或在仓库根目录自行打包：`python3 scripts/build-themes.py --only aurora-glass`
   （产物 `dist/aurora-glass.zip`）；
2. 管理后台 → **系统 → 主题** → **上传主题包**，选择这个 zip；
3. 勾选「安装后立即切换」（接口参数 `activate=1`）可直接生效；
4. 同名主题会被**整目录替换**——这就是"更新同一主题"的方式，
   不会把上一版多出来的文件留在新版本里。

> **zip 文件名就是主题名**：必须是 `aurora-glass.zip`，zip 根目录下就是 `theme.json`。
> 上传接口 `POST /api/admin/v1/themes/upload`（multipart，字段 `file`），上限 32 MB；
> zip-slip、单文件 16 MB、缺 `theme.json` 都会被服务端拒绝，失败会还原旧主题。

### 方式 B：从仓库拷贝目录到 themes 目录

外部主题的加载目录由 Master 的 `themes_dir` 决定，安装脚本的默认值是
**`/var/lib/xb-probe-master/themes`**（即 `data_dir/themes`；`data_dir`
默认 `/var/lib/xb-probe-master`，两者都以实际 `master.yaml` 为准）。

Master 服务以专用低权限用户 **`probe`** 运行（systemd 单元里是
`User=probe` / `Group=probe`），主题静态文件必须让该用户可读。

仓库是"一个目录一个主题"的结构，**要拷的是 `aurora-glass/` 这个子目录**；
落点目录名保持 `aurora-glass`（目录名就是主题标识，`theme.json` 的 `name` 只是显示名）：

```bash
# 只取需要的主题目录，不把整个仓库（含其它主题）塞进 themes_dir
git clone --depth 1 https://github.com/koyoca/XBProbe-Theme.git /tmp/xbt
sudo cp -r /tmp/xbt/aurora-glass /var/lib/xb-probe-master/themes/aurora-glass
sudo rm -rf /tmp/xbt
```

```bash
# 方式 C：本地打 tar 包再上传（不装 git、也没有后台权限的机器）
git clone --depth 1 https://github.com/koyoca/XBProbe-Theme.git /tmp/xbt
tar -czf aurora-glass.tar.gz -C /tmp/xbt/aurora-glass .
# 上传后在服务器上解压（落点仍是 aurora-glass）：
sudo mkdir -p /var/lib/xb-probe-master/themes/aurora-glass
sudo tar -xzf aurora-glass.tar.gz -C /var/lib/xb-probe-master/themes/aurora-glass
```

```bash
# 修正归属与权限（用 B/C 两种方式装完都做一遍）
sudo chown -R probe:probe /var/lib/xb-probe-master/themes/aurora-glass
sudo chmod -R a+rX /var/lib/xb-probe-master/themes/aurora-glass

# 核对：目录名、文件都在、probe 用户真的读得到
ls -ld /var/lib/xb-probe-master/themes/aurora-glass
ls /var/lib/xb-probe-master/themes/aurora-glass
sudo -u probe test -r /var/lib/xb-probe-master/themes/aurora-glass/theme.json \
  && echo "probe 可读 ✓" || echo "probe 读不到，检查归属/权限"
```

注意：

- 必需文件（少一个主题都会被跳过或渲染残缺）：
  `theme.json`、`index.html`、`style.css`、`app.js`（`favicon.svg` 可选）。
- `themes_dir` 在部署时被写进配置（`master.yaml` 的 `themes_dir: "/var/lib/xb-probe-master/themes"`）；
  如果你改过 `--data` 或 `themes_dir`，以那个值为准。
- 用 A（上传）方式装的，服务端会自动处理归属，**不需要**手工 chown；
  只有 B/C 手工拷进去的才需要上面那段。

```bash
# 重启 Master 让主题被扫描到（用 A 方式上传的不需要重启）
sudo systemctl restart xb-probe-master
```

## 启用

登录管理后台 → **系统 → 主题**：

1. 在主题下拉里选择 `aurora-glass（外部）— Aurora Glass · 极光琉璃`；
2. 点「应用」，外部主题会弹一次确认（第三方主题与页面同源运行，
   等同于可信代码）——确认后立即热切换，无需重启。

之后公开看板即使用本主题。切换别的主题后本目录可以保留，随时切回。

## 特性

- **深浅双模**：默认跟随系统（`prefers-color-scheme`）；顶栏按钮手动切换并记住
  （`localStorage['probe.theme']`）；`?theme=dark|light` 查询参数只作用本次加载，便于截图与排障。
- **在线情况时间线**（详情页 · 探测延迟）：`GET /nodes/{id}/online` 的逐格数据画成
  一条玻璃时间线——绿色=有上报、玫红=无上报、浅灰=当时还没有数据（"还没部署"
  不会被误读成"离线"）。格长跟随设置项 `online.segment_min`，标题旁的汇总给出
  断线次数 / 累计时长 / 最长一次。
- **延迟明细四项分列**：延迟区间（min~max）、丢包（窗口综合 + 括号内单段峰值）、
  抖动、断点次数，最后才是延迟等级——每项都带主语，避免把"延迟很高"读成"丢包很高"。
  丢包小于 0.1% 时显示两位小数（0.04% 不再被压成 0.0%）。
- **丢包口径与平台一致**：卡片点阵上的丢包是**窗口综合值**（各段非空平均），
  不是最后一个桶——最近一段恢复成 0% 也不会掩盖刚发生过的丢包。
- **后台开关全兼容**：`settings.public.cards` 的 `null / [] / [...]` 三态、
  `public.fields` 字段收窄、`public.lat_window` 时间窗（30m/1h/6h/24h）、
  `admin_url` 后台入口跳转，全部按下发值渲染，不写死。
- **布局稳定**：以 `public_id` 为键复用 DOM，轮询只改文本与宽度；
  缺值渲染 `—` 而不省略行；没有探测目标时点阵块整块隐藏（不补占位行）。
- **零外部依赖**：无字体、无 CDN、无图片请求；国旗是内置 SVG 表、
  图标是内联 SVG、图表是 Canvas 手绘；整个主题离线可用。
- **可读性兜底**：浏览器不支持 `backdrop-filter` 时退化为实色面；
  不支持 `mask-composite` 时悬停退回朴素的边框变色；
  `prefers-reduced-motion` 时极光停转、呼吸点静止。

## 兼容性

- 浏览器：任何支持 ES5 + `fetch` + CSS 变量与 `backdrop-filter` 的现代浏览器
  （Chrome/Edge 76+、Safari 9+ 起基本可用；毛玻璃在 Safari 需 `-webkit-` 前缀，
  已同时下发）。
- XB-Probe：公开 API 版本 `v1`（`/api/public/v1/*`），与内置主题同一套接口。
  其中「在线情况」需要提供 `GET /nodes/{id}/online` 的 Master 版本；更早的
  Master 上该区块保持空（其余功能不受影响，请求失败会被静默跳过）。

## 许可

- 主题内容（结构 / 样式 / 脚本 / 图标）均为本项目的原创实现。
- 国旗图形取自 XB-Probe 内置前端的同一张 SVG 表，以保持看板与后台的显示一致。
