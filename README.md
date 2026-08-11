# Storyboard Reference Studio｜分镜参考工作室

面向中文影视创作者的本地优先工作台，用来整理分镜参考、镜头图像资料库、视觉风格标签和 AI 图像/视频提示词。

当前版本已迁移到 **Tauri 2 + React 18 + Vite**，默认中文界面，Windows 可直接构建 release exe、MSI 和 NSIS 安装包。

## 产品定位

Storyboard Reference Studio 不是剪辑软件，而是一个“镜头参考整理台”：

- **分镜参考板**：从视频、剧照、手机素材或美术参考中抽出关键画面，形成可排序的参考卡片。
- **镜头图像资料库**：为每张参考记录场次、镜号、景别、机位、焦段、镜头运动、转场和时长。
- **视觉风格检索工作台**：按场景、镜头类型、构图、光线、色彩、情绪、人物/地点/美术标签筛选参考。
- **AI 视觉开发提示词**：每张参考可保存图像/视频模型提示词，支持 Midjourney、Flux、GPT-Image、Nano Banana、SDXL 和通用描述。
- **本地导出**：输出参考包、动态分镜 MP4、2×3 图文 PDF 分镜页和镜头清单 CSV。

## 内置中文 Demo

欢迎页点击 **“加载雨夜灯塔 Demo”**，会一键生成完整中文参考板：

- 主题：**雨夜灯塔视觉参考板**
- 镜头参考：10 条
- 场景覆盖：外景沿海公路、皮卡车内、灯塔外部入口、灯塔楼梯井、灯室、开阔海面、灯室控制台
- 标签：50 个以上唯一中文标签
- 每条参考包含：中文标题、镜头类型、构图、光线、色彩、情绪、用途、对应场景/镜头、AI 图像/视频提示词备注

## 快速开始

```bash
npm install
npm run dev
```

如果 5173 被占用，Vite 会自动使用后续空闲端口；`npm run tauri:dev` 也会动态写入匹配的 Tauri devUrl。


## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动前端开发服务 |
| `npm run build` | 构建前端到 `dist/` |
| `npm run smoke` | 启动本地前端、加载中文 Demo、检查中文文本/参考卡/标签/筛选/详情面板并截图 |
| `npm run smoke:tauri` | 启动 Tauri release exe，通过 WebView2 CDP 自动加载 Demo，并用 release sidecar 导出 PDF/MP4/CSV/参考包 |
| `npm run prepare:ffmpeg` | 从 npm sidecar 包复制 ffmpeg/ffprobe 到 `src-tauri/bin/` 供 Tauri 打包 |
| `npm run sign:windows` | 对 release exe、MSI 和 NSIS 安装包执行 Windows 签名/验签并输出签名 manifest |
| `cargo check` | 在 `src-tauri/` 下检查 Rust/Tauri 命令 |
| `cargo test export_animatic_writes_real_mp4 -- --nocapture` | 验证动态分镜 MP4 真实导出为 1920x1080 |
| `cargo test export_pdf_writes_storyboard_grid -- --nocapture` | 验证 PDF 导出是真正 2x3 图文分镜页 |
| `npm run tauri:dev` | 启动 Tauri 开发版，自动避开占用端口 |
| `npm run tauri:build` | 复制 ffmpeg/ffprobe sidecar，并构建 Windows release exe、MSI 和 NSIS 安装包 |
## Smoke 验收

```bash
npm run smoke
```

smoke 会：

- 自动选择空闲端口，不覆盖其他项目服务
- 默认中文环境
- 加载「雨夜灯塔」Demo
- 检查参考卡数量、筛选标签数量、关键中文文本、筛选入口和详情面板
- 输出截图到 `output/playwright/`

典型输出：

```json
{
  "ok": true,
  "cardCount": 10,
  "filterChipCount": 25,
  "detailRows": 9,
  "detailTags": 6,
  "filteredCount": 3
}
```

## Release 构建

```bash
npm run build
cd src-tauri
cargo check
cd ..
npm run tauri:build
```

Windows 产物位置：

- `src-tauri/target/release/storyboard-reference-studio.exe`
- `src-tauri/target/release/bundle/nsis/Storyboard Reference Studio_2.0.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Storyboard Reference Studio_2.0.0_x64_en-US.msi`

Tauri bundle identifier 当前为：

```json
"identifier": "studio.storyboard.reference"
```

### Windows 代码签名与 SmartScreen 友好发布

`npm run sign:windows` 会扫描 release exe、MSI 和 NSIS 安装包，使用 Windows SDK `signtool.exe` 做 SHA256 摘要签名和 RFC3161 时间戳，并输出 `output/signing/windows-signing-manifest.json`。正式发版建议：

- 配置 `WINDOWS_SIGNING_CERTIFICATE_BASE64` + `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`，或 `WINDOWS_SIGNING_CERT_THUMBPRINT` / `WINDOWS_PFX_PATH`
- 设置 `WINDOWS_PUBLISHER_NAME` 为稳定发布者名称，默认 `BloomReel Team`
- 设置 `WINDOWS_TIMESTAMP_URL`，默认 `http://timestamp.digicert.com`
- 手动触发 CI release gate 时勾选 `require_signing`，等价于 `WINDOWS_SIGNING_REQUIRED=1`
- 始终从同一 GitHub release 渠道发布已签名安装包，保持产品名与 Tauri identifier 稳定，帮助 SmartScreen 累积发布者信誉

## 导出内容

### 参考包

导出文件夹结构：

```text
exports/board-YYYYMMDD-HHMMSS/
├── 01_参考标题/
│   ├── still.png
│   └── prompt.txt
├── prompts.json
├── contact-sheet.png
└── board.md
```


### PDF 图文分镜页

PDF 导出不再是最小占位文件，而是 A4 横版 2×3 图文分镜页：

- 自动生成品牌封面页与目录/场次索引页
- 每页 6 张参考卡，超过 6 张自动分页
- 每页带 Storyboard Reference Studio 品牌页眉、页码、场次/镜号索引和本地资料库页脚
- 页面包含打印出血/安全框参考，以及导演、摄影指导、美术指导、制片、日期片场签批栏
- 导出菜单提供 **导演版/美术版** 两套模板：导演版偏场次、运动、转场和调度意图；美术版偏构图、光线、色彩、情绪和视觉开发用途
- 每套模板都支持浅色版与深色版，文件名会标记 `director-light`、`director-dark`、`art-light` 或 `art-dark`
- 每张卡包含缩略图、中文标题、场景/镜头类型、构图、光线、色彩/情绪、用途和 AI 图像/视频提示词
- 中文文本会使用系统中文字体渲染到页面图像，再嵌入 PDF，避免 release 环境字体乱码
### 动态分镜 MP4

动态分镜导出现在是真实 MP4，而不是占位文本：

- 分辨率：1920 x 1080
- 帧率：24fps
- 编码：H.264 / yuv420p
- 每张参考按 `durationS` 保持时长
- 导出菜单可开关淡入淡出、镜头编号烧录、参考标题烧录
- 如项目设置了临时声音轨，会先生成波形 PNG 做可识别音频校验，再 mux 到视频中

## 项目结构

```text
src/shared/       文档模型、schema 迁移、生成器 profile、标注 SVG
src/renderer/     React UI、中文 Demo、store、Tauri bridge、面板组件
src-tauri/        Tauri 2 原生命令、项目读写、导入、抽帧、导出、打包配置
scripts/          smoke 与动态端口 Tauri dev 启动脚本
output/playwright smoke 截图输出目录
mcp/              MCP 桥接脚本资源
```

## 本地优先与离线模式

项目保存在本机 `.sbref` 文件夹中，包含：

- `project.json`
- `media/`
- `.frames/`
- `.autosave/`
- `exports/`

导入、整理、检索、保存、导出均可本地运行。release 构建会通过 `npm run prepare:ffmpeg` 打包 ffmpeg/ffprobe sidecar；运行时仍支持 `SBR_FFMPEG` / `SBR_FFPROBE` 环境变量和系统路径探测，减少用户机器预装依赖。在线视觉分析尚未接入当前 Tauri 版本；右侧 **“离线模板”** 可根据镜头信息、光线和情绪生成 AI 图像/视频提示词草稿。

## Windows Release CI

`.github/workflows/windows-release-gate.yml` 会在 Windows 上执行完整 release 门禁：

- `npm ci`
- `npm run prepare:ffmpeg`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run tauri:build`
- `npm run smoke`
- `npm run smoke:tauri`

CI 会上传 `output/playwright/` 截图与 `src-tauri/target/release/bundle/` 安装包，方便复核 release 构建、sidecar 调用和导出链路。


## 授权与署名

BloomReel Proprietary License，见 `LICENSE`。此 Rust/Tauri 版本为 BloomReel 闭源版本。

本项目由 **BloomReel Team** 打造；第三方组件继续遵循其各自许可证与 NOTICE。
