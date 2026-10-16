# Aurora Glass · 极光琉璃

XB-Probe（小白探针）的**外部公开看板主题**：极光渐变背景 + 毛玻璃卡片。

> 本目录是**独立项目**，不属于 XB-Probe 仓库，也不依赖它的任何构建步骤。
> 把整个目录拷进 XB-Probe 的 `themes_dir` 即可导入使用。

```
aurora-glass/
├── theme.json      主题元数据（名称/版本/入口/说明）
├── index.html      入口页（结构）
├── style.css       全部样式（设计令牌 + 组件）
├── app.js          全部脚本（取数 / 渲染 / Canvas 图表）
└── favicon.svg     站点图标
```

## 风格来源

从参考主题 `theme-glassmorphism`（Vue 打包产物）中提取设计语言，落到
XB-Probe 的原生前端约束（零外部依赖、CSP `default-src 'self'`）之下：

| 提取到的设计 | 在本主题中的落地 |
|---|---|
| 毛玻璃材质：半透明面 + `backdrop-filter: blur + saturate` + 1px 亮边 + 内侧高光 | `--glass / --glass-border / --glass-inset` 三件套，全部容器通用 |
| 极光/图片背景透过玻璃呈色 | 四团 CSS 径向渐变光斑缓慢漂移（青/靛/品红/金），`prefers-reduced-motion` 时静止 |
| 卡片大圆角 + 柔和投影托离纸面 | `--radius: 16px`，`--glass-shadow` 双层柔影；hover 抬升一档 |
| **节点卡片：2×2 指标格**（CPU/内存/磁盘/流量各占一格，格内标签+数值+进度条+说明） | `.n-tiles` + `.tile`，四格自动排布；某格被后台关闭时余下奇数格自动铺满整行 |
| 指标按用量分档着色（绿→琥珀→玫红），而非单色 | `.bar i.warn / .bad` 与 `.tile.warn / .bad`，分档阈值 75% / 90% |
| 延迟点阵：每条目标一行，色段表达严重度 | `.strip` + `.seg`，五档色阶（≤50 / ≤100 / ≤200 / ≤500 / >500 ms），丢包独立一行 |
| 顶部状态点 + 名称 + 状态胶囊 | `.n-head`：呼吸态在线点（唯一带光环的元素）、国旗、状态胶囊按状态着色 |
| 顶栏吸顶 + 毛玻璃 + 渐变标题 | `.topbar` + `.site-title` 渐变色文字 |
| 彩色分级进度条 + 彩色图表 | 每条指标一个色相（青/紫/琥珀/翠/玫红），图表按指标取色、延迟按序号取极光色相 + 虚线 |

与参考主题的两点**有意不同**：

1. 参考主题的卡片内容由 Vue 组件承载；本主题所有 DOM 由 `app.js` 用
   `textContent` 手工构建（CSP 禁 `innerHTML` 之外，也符合平台
   "渲染不可信字符串一律 textContent"的约定）。
2. 参考主题自带地球视图与地图；XB-Probe 的公开 API 不含坐标数据，
   本主题不引入地理组件，把版面让给指标与曲线。

## 安装（导入 XB-Probe）

外部主题的加载目录由 Master 的 `themes_dir` 决定，默认
`<data_dir>/themes`（`master.yaml` 未配置时即 `data_dir/themes`）。

```bash
# 1) 把整个目录拷到主题目录下（目录名即主题名）
scp -r aurora-glass root@<master-host>:/var/lib/xb-probe/themes/

# 或者直接在服务器上解压/克隆
sudo cp -r aurora-glass /var/lib/xb-probe/themes/
sudo chown -R xb-probe:xb-probe /var/lib/xb-probe/themes/aurora-glass
chmod -R a+rX /var/lib/xb-probe/themes/aurora-glass
```

注意：

- 主题目录下的**目录名**就是主题标识（这里即 `aurora-glass`），
  与 `theme.json` 里的 `name`（显示名）是两回事。
- 静态文件由 Master 直接读取，确保运行用户（`xb-probe`）可读；
  `theme.json` 与四个文件缺一不可。
- `themes_dir` 改过位置时以实际值为准（Master 启动时扫描一次，
  新增主题后重启 Master 或等待热扫描生效）。

```bash
# 2) 重启 Master 让主题被扫描到（若版本支持动态扫描可跳过）
sudo systemctl restart xb-probe-master
```

## 启用

登录管理后台 → **设置 / 主题**：

1. 在主题下拉里选择 `aurora-glass（外部）— Aurora Glass · 极光琉璃`；
2. 点「应用」，外部主题会弹一次确认（第三方主题与页面同源运行，
   等同于可信代码）——确认后立即热切换，无需重启。

之后公开看板即使用本主题。切换别的主题后本目录可以保留，随时切回。

## 特性

- **深浅双模**：默认跟随系统（`prefers-color-scheme`）；顶栏按钮手动切换并记住
  （`localStorage['probe.theme']`）；`?theme=dark|light` 查询参数只作用本次加载，便于截图与排障。
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

## 许可与致谢

- 设计语言参考并致谢 [Theme-Glassmorphism](https://github.com/Gongsc/Theme-Glassmorphism)（Gongsc）。
- 国旗图形与原主题无关，取自 XB-Probe 内置前端的同一张 SVG 表（保持看板与后台一致）。
