[English](#english) | [中文](#中文)

---

# English

# Chinese Video Auto-Transcriptor

![Version](https://img.shields.io/badge/version-1.5.5-blue)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

Chrome extension (Manifest V3) that records audio from any browser tab and transcribes Chinese speech into timestamped Markdown files — entirely in-browser or via cloud API.

## Features

- **Dual transcription engines** — local Whisper (via `@huggingface/transformers`) or cloud DashScope Paraformer, with automatic fallback
- **Pause / resume recording** at any time from popup or in-page overlay
- **In-page recording overlay** — Shadow DOM widget with live timer, pause/resume/stop controls, and color-coded status
- **Auto-pause on video seek** — automatically pauses recording when user scrubs the video timeline, resumes after 500 ms debounce
- **Badge status indicators** — extension icon badge shows current state: `REC` (recording), `||` (paused), `...` (transcribing), `✓` (done), `!` (error)
- **Automatic Markdown export** — YAML frontmatter (title, URL, duration, model, timestamp) plus full text and timestamped segments
- **Traditional-to-Simplified Chinese conversion** via OpenCC
- **WebGPU acceleration** when available, WASM fallback otherwise
- **Hallucination filtering** — 14 pattern matchers, internal repetition detection, and consecutive near-duplicate removal
- **Audio peak normalization** — quiet recordings are scaled up before transcription for better accuracy
- **Missed result recovery** — if the popup is closed during transcription, results are stored and shown when the popup reopens (within 5 minutes)
- **Service worker state persistence** — recording state is saved to `chrome.storage.local` and restored when the service worker wakes up
- **Service worker keepalive** — 25-second heartbeat messages prevent the service worker from going idle during long transcriptions

## Installation

### Build from source

```bash
git clone <repo-url>
cd "Video Transcriptor"
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the `dist/` folder

## Usage

1. Navigate to a tab playing Chinese audio or video.
2. Click the extension icon to open the popup.
3. Click **开始录制** (Start Recording). Grant audio capture permission if prompted.
4. An in-page overlay appears in the top-right corner of the tab showing a live timer and controls.
5. Use **暂停** / **继续** to pause and resume (from either the popup or the overlay).
6. If you seek/scrub the video timeline, recording auto-pauses and resumes after the seek completes.
7. Watch the extension badge for status: `REC` = recording, `||` = paused, `...` = transcribing.
8. Click **停止并转录** (Stop & Transcribe) when done.
9. A `.md` file downloads automatically with the timestamped transcript.
10. If you close the popup before transcription finishes, reopen it — results are saved and displayed automatically.

### First run (local Whisper)

The first transcription with local Whisper downloads the `Xenova/whisper-small` model (~50 MB). Progress is shown in the popup. Subsequent runs use the browser cache.

## DashScope Configuration

By default the extension transcribes locally using Whisper. For faster cloud transcription:

1. Get an API key from [Alibaba Cloud DashScope](https://dashscope.aliyuncs.com/).
2. Click the gear icon in the popup.
3. Paste your API key and click **保存** (Save).

When a key is configured the extension uses DashScope Paraformer (async file-upload flow: upload → submit → poll). If the cloud call fails it falls back to local Whisper automatically.

### Testing your API key

Use the standalone diagnostic script to verify connectivity:

```bash
node test-dashscope.mjs <your-api-key>
# or
DASHSCOPE_API_KEY=sk-xxx node test-dashscope.mjs
```

It sends a 1-second silent WAV to the DashScope sync endpoint and reports whether the key is valid.

## Architecture

```
┌──────────────────┐   messages   ┌──────────────────┐   messages   ┌──────────────────────┐
│   Popup (UI)     │◄────────────►│  Service Worker   │◄────────────►│  Offscreen Document   │
│   popup.js       │              │  background.js    │              │  offscreen.js          │
│                  │              │                   │              │  ├─ MediaRecorder       │
│  • Start/stop    │              │  • chrome.tab-    │              │  ├─ Whisper pipeline    │
│  • Pause/resume  │              │    Capture        │              │  ├─ DashScope client    │
│  • Settings      │              │  • Badge updates  │              │  ├─ OpenCC (T→S)        │
│  • Progress UI   │              │  • State persist  │              │  ├─ Hallucination filter│
│  • Missed result │              │  • Keepalive      │              │  └─ Markdown generator  │
│    recovery      │              │  • File download  │              │                        │
└──────────────────┘              │  • Content script │              └──────────────────────┘
                                  │    injection      │
                                  └────────┬─────────┘
                                           │ scripting.executeScript
                                  ┌────────▼─────────┐
                                  │  Content Script   │
                                  │  content.js       │
                                  │                   │
                                  │  • Shadow DOM      │
                                  │    overlay         │
                                  │  • Live timer      │
                                  │  • Pause/resume/   │
                                  │    stop buttons    │
                                  │  • Video seek      │
                                  │    detection       │
                                  │  • Error panel     │
                                  └───────────────────┘
```

- **Popup** — controls recording state, displays progress and results, manages DashScope settings, recovers missed results from storage.
- **Service Worker** — routes messages between components, manages `chrome.tabCapture`, updates the badge, persists state to `chrome.storage.local`, sends keepalive heartbeats, triggers file downloads, injects the content script.
- **Offscreen Document** — captures audio via `MediaRecorder`, runs local Whisper or cloud DashScope transcription, converts Traditional→Simplified Chinese, filters hallucinations, generates Markdown output.
- **Content Script** — injects a Shadow DOM overlay into the active tab with live timer, color-coded status, pause/resume/stop controls, video seek detection (auto-pause/resume), and an error detail panel.

## Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome  | 116+    | Supported |
| Edge    | 116+    | Supported |
| Firefox | —       | Not supported (no `chrome.offscreen` API) |

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `activeTab` | Access the currently active tab to capture audio |
| `tabCapture` | Capture audio stream from the tab via `getMediaStreamId()` |
| `offscreen` | Create an offscreen document for `MediaRecorder` and Whisper (service workers cannot use these APIs) |
| `storage` | Persist DashScope API key, recording state, and missed transcription results |
| `downloads` | Save the generated Markdown file to the user's downloads folder |
| `scripting` | Inject the content script (recording overlay) into the active tab |
| `host_permissions: https://*.aliyuncs.com/*` | Upload audio and poll transcription results from DashScope API |

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Commands

```bash
npm install          # install dependencies
npm run dev          # start Vite dev server with HMR
npm run build        # production build to dist/

# DashScope API diagnostics
node test-dashscope.mjs <api-key>
```

### Project structure

```
src/
├── assets/
│   ├── icon-16.png          # extension icon 16x16
│   ├── icon-48.png          # extension icon 48x48
│   └── icon-128.png         # extension icon 128x128
├── background/
│   └── background.js        # service worker: message routing, badge, state persistence, keepalive
├── content/
│   └── content.js           # content script: Shadow DOM overlay, timer, controls, seek detection
├── offscreen/
│   ├── offscreen.html       # offscreen document entry
│   ├── offscreen.js         # audio capture, Whisper/DashScope transcription, Markdown generation
│   └── audio-processor.js   # WebM→Float32 conversion, 16kHz resampling, peak normalization, WAV encoding
├── popup/
│   ├── popup.html           # popup UI
│   ├── popup.css            # popup styles
│   └── popup.js             # popup logic: controls, progress, settings, missed result recovery
└── utils/
    ├── constants.js         # shared constants (model name, DashScope URL, formatTime, sanitizeFilename)
    ├── dashscope.js         # DashScope Paraformer client (upload→submit→poll→fetch 3-step async flow)
    ├── hallucination-filter.js  # 14 pattern matchers, repetition detection, near-duplicate removal
    ├── markdown-generator.js    # YAML frontmatter + full text + timestamped segments
    └── messages.js          # message type constants shared across all components

manifest.json                # Chrome MV3 manifest
vite.config.js               # Vite build config with plugins
test-dashscope.mjs           # standalone DashScope API diagnostic tool
```

### Build tooling

| Tool | Purpose |
|------|---------|
| Vite 7 | Bundler |
| `@crxjs/vite-plugin` | Chrome extension dev support (HMR, manifest processing) |
| `vite-plugin-static-copy` | Copies ONNX Runtime WASM files and content script to build output |
| `offscreenDevPlugin` (custom) | Generates offscreen HTML with Vite dev server URLs during `npm run dev` |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"录制启动失败" (Recording failed to start)** | Make sure you clicked the extension icon from a normal web page. Chrome internal pages (`chrome://`, `edge://`, `chrome-extension://`) do not allow audio capture. |
| **Model download stuck or fails** | Check your internet connection. The first run downloads ~50 MB from Hugging Face. If behind a proxy, ensure `huggingface.co` is reachable. |
| **Transcription is empty or garbled** | The audio may be too quiet. Peak normalization helps, but extremely low-volume audio may still produce poor results. Try a different video or increase system volume. |
| **DashScope returns 401/403** | Your API key is invalid or expired. Use `node test-dashscope.mjs <key>` to diagnose. |
| **Overlay does not appear** | The content script cannot inject into restricted pages (Chrome Web Store, `chrome://` pages, PDF viewer). |
| **"已有录制正在进行中" (Recording already in progress)** | Another tab is already being recorded. Stop the current recording first. |

## License

MIT

---

# 中文

# 中文视频自动转录器

![版本](https://img.shields.io/badge/版本-1.5.5-blue)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-green)
![许可证](https://img.shields.io/badge/许可证-MIT-brightgreen)

Chrome 扩展（Manifest V3），可录制任意浏览器标签页的音频并将中文语音转录为带时间戳的 Markdown 文件——完全在浏览器内完成，或通过云端 API。

## 功能特性

- **双转录引擎** — 本地 Whisper（通过 `@huggingface/transformers`）或云端 DashScope Paraformer，支持自动回退
- **暂停 / 继续录制** — 可随时从弹出窗口或页内悬浮窗控制
- **页内录制悬浮窗** — Shadow DOM 组件，显示实时计时器、暂停/继续/停止按钮和颜色编码状态
- **视频跳转自动暂停** — 用户拖动视频进度条时自动暂停录制，跳转完成后 500 毫秒自动恢复
- **徽标状态指示** — 扩展图标徽标显示当前状态：`REC`（录制中）、`||`（已暂停）、`...`（转录中）、`✓`（完成）、`!`（出错）
- **自动导出 Markdown** — 包含 YAML 前置元数据（标题、URL、时长、模型、时间戳）以及完整文本和分段时间戳
- **繁体转简体中文** — 通过 OpenCC 自动转换
- **WebGPU 加速** — 可用时使用 WebGPU，否则回退到 WASM
- **幻觉过滤** — 14 种模式匹配、内部重复检测和连续近似重复段落去除
- **音频峰值归一化** — 安静的录音在转录前会被放大，提高识别准确率
- **错过结果恢复** — 转录期间关闭弹出窗口，结果会被保存，重新打开时自动显示（5 分钟内有效）
- **Service Worker 状态持久化** — 录制状态保存到 `chrome.storage.local`，Service Worker 唤醒后自动恢复
- **Service Worker 保活** — 每 25 秒发送心跳消息，防止长时间转录期间 Service Worker 休眠

## 安装

### 从源码构建

```bash
git clone <repo-url>
cd "Video Transcriptor"
npm install
npm run build
```

### 在 Chrome 中加载

1. 打开 `chrome://extensions`
2. 启用右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择 `dist/` 文件夹

## 使用方法

1. 打开一个正在播放中文音频或视频的标签页。
2. 点击扩展图标打开弹出窗口。
3. 点击 **开始录制**。如提示，请授予音频捕获权限。
4. 页面右上角会出现录制悬浮窗，显示实时计时器和控制按钮。
5. 使用 **暂停** / **继续** 控制录制（弹出窗口或悬浮窗均可）。
6. 拖动视频进度条时，录制会自动暂停并在跳转完成后恢复。
7. 关注扩展徽标的状态：`REC` = 录制中，`||` = 已暂停，`...` = 转录中。
8. 完成后点击 **停止并转录**。
9. `.md` 文件会自动下载，包含带时间戳的转录内容。
10. 如果在转录完成前关闭了弹出窗口，重新打开即可——结果会自动保存并显示。

### 首次运行（本地 Whisper）

首次使用本地 Whisper 转录时会下载 `Xenova/whisper-small` 模型（约 50 MB）。下载进度会在弹出窗口中显示。后续运行使用浏览器缓存。

## DashScope 配置

默认使用本地 Whisper 转录。如需更快的云端转录：

1. 从[阿里云 DashScope](https://dashscope.aliyuncs.com/) 获取 API 密钥。
2. 点击弹出窗口中的齿轮图标。
3. 粘贴 API 密钥并点击 **保存**。

配置密钥后，扩展会使用 DashScope Paraformer（异步文件上传流程：上传→提交→轮询）。如果云端调用失败，会自动回退到本地 Whisper。

### 测试 API 密钥

使用独立诊断脚本验证连通性：

```bash
node test-dashscope.mjs <你的API密钥>
# 或
DASHSCOPE_API_KEY=sk-xxx node test-dashscope.mjs
```

它会发送一段 1 秒的静音 WAV 到 DashScope 同步接口，并报告密钥是否有效。

## 架构

```
┌──────────────────┐   消息通信   ┌──────────────────┐   消息通信   ┌──────────────────────┐
│   弹出窗口 (UI)   │◄────────────►│  Service Worker   │◄────────────►│   离屏文档            │
│   popup.js       │              │  background.js    │              │  offscreen.js          │
│                  │              │                   │              │  ├─ MediaRecorder       │
│  • 开始/停止     │              │  • chrome.tab-    │              │  ├─ Whisper 管道        │
│  • 暂停/继续     │              │    Capture        │              │  ├─ DashScope 客户端    │
│  • 设置管理      │              │  • 徽标更新       │              │  ├─ OpenCC（繁→简）     │
│  • 进度显示      │              │  • 状态持久化     │              │  ├─ 幻觉过滤           │
│  • 错过结果恢复  │              │  • 保活心跳       │              │  └─ Markdown 生成       │
│                  │              │  • 文件下载       │              │                        │
└──────────────────┘              │  • 内容脚本注入   │              └──────────────────────┘
                                  └────────┬─────────┘
                                           │ scripting.executeScript
                                  ┌────────▼─────────┐
                                  │   内容脚本        │
                                  │   content.js      │
                                  │                   │
                                  │  • Shadow DOM      │
                                  │    悬浮窗          │
                                  │  • 实时计时器      │
                                  │  • 暂停/继续/      │
                                  │    停止按钮        │
                                  │  • 视频跳转检测    │
                                  │  • 错误详情面板    │
                                  └───────────────────┘
```

- **弹出窗口** — 控制录制状态，显示进度和结果，管理 DashScope 设置，从存储中恢复错过的结果。
- **Service Worker** — 在各组件间路由消息，管理 `chrome.tabCapture`，更新徽标，将状态持久化到 `chrome.storage.local`，发送保活心跳，触发文件下载，注入内容脚本。
- **离屏文档** — 通过 `MediaRecorder` 捕获音频，运行本地 Whisper 或云端 DashScope 转录，繁体→简体中文转换，过滤幻觉，生成 Markdown 输出。
- **内容脚本** — 向活动标签页注入 Shadow DOM 悬浮窗，包含实时计时器、颜色编码状态、暂停/继续/停止按钮、视频跳转检测（自动暂停/恢复）和错误详情面板。

## 浏览器兼容性

| 浏览器 | 版本 | 状态 |
|--------|------|------|
| Chrome | 116+ | 支持 |
| Edge   | 116+ | 支持 |
| Firefox | —   | 不支持（无 `chrome.offscreen` API） |

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` | 访问当前活动标签页以捕获音频 |
| `tabCapture` | 通过 `getMediaStreamId()` 捕获标签页的音频流 |
| `offscreen` | 创建离屏文档以使用 `MediaRecorder` 和 Whisper（Service Worker 不能使用这些 API） |
| `storage` | 持久化存储 DashScope API 密钥、录制状态和错过的转录结果 |
| `downloads` | 将生成的 Markdown 文件保存到用户的下载文件夹 |
| `scripting` | 向活动标签页注入内容脚本（录制悬浮窗） |
| `host_permissions: https://*.aliyuncs.com/*` | 上传音频和轮询 DashScope API 的转录结果 |

## 开发

### 前置条件

- Node.js 18+
- npm 9+

### 命令

```bash
npm install          # 安装依赖
npm run dev          # 启动 Vite 开发服务器（支持热更新）
npm run build        # 生产构建，输出到 dist/

# DashScope API 诊断
node test-dashscope.mjs <api-key>
```

### 项目结构

```
src/
├── assets/
│   ├── icon-16.png          # 扩展图标 16x16
│   ├── icon-48.png          # 扩展图标 48x48
│   └── icon-128.png         # 扩展图标 128x128
├── background/
│   └── background.js        # Service Worker：消息路由、徽标、状态持久化、保活
├── content/
│   └── content.js           # 内容脚本：Shadow DOM 悬浮窗、计时器、控制按钮、跳转检测
├── offscreen/
│   ├── offscreen.html       # 离屏文档入口
│   ├── offscreen.js         # 音频捕获、Whisper/DashScope 转录、Markdown 生成
│   └── audio-processor.js   # WebM→Float32 转换、16kHz 重采样、峰值归一化、WAV 编码
├── popup/
│   ├── popup.html           # 弹出窗口 UI
│   ├── popup.css            # 弹出窗口样式
│   └── popup.js             # 弹出窗口逻辑：控制、进度、设置、错过结果恢复
└── utils/
    ├── constants.js         # 共享常量（模型名、DashScope URL、formatTime、sanitizeFilename）
    ├── dashscope.js         # DashScope Paraformer 客户端（上传→提交→轮询→获取 三步异步流程）
    ├── hallucination-filter.js  # 14 种模式匹配、重复检测、近似重复去除
    ├── markdown-generator.js    # YAML 前置元数据 + 完整文本 + 分段时间戳
    └── messages.js          # 所有组件共享的消息类型常量

manifest.json                # Chrome MV3 清单文件
vite.config.js               # Vite 构建配置（含插件）
test-dashscope.mjs           # 独立 DashScope API 诊断工具
```

### 构建工具

| 工具 | 用途 |
|------|------|
| Vite 7 | 打包工具 |
| `@crxjs/vite-plugin` | Chrome 扩展开发支持（热更新、清单处理） |
| `vite-plugin-static-copy` | 将 ONNX Runtime WASM 文件和内容脚本复制到构建输出 |
| `offscreenDevPlugin`（自定义） | 在 `npm run dev` 期间生成包含 Vite 开发服务器 URL 的离屏 HTML |

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| **"录制启动失败"** | 确保从普通网页点击扩展图标。Chrome 内部页面（`chrome://`、`edge://`、`chrome-extension://`）不允许音频捕获。 |
| **模型下载卡住或失败** | 检查网络连接。首次运行需从 Hugging Face 下载约 50 MB 模型。如使用代理，请确保 `huggingface.co` 可访问。 |
| **转录结果为空或乱码** | 音频可能过于安静。峰值归一化会有所帮助，但极低音量的音频仍可能产生较差结果。尝试其他视频或增大系统音量。 |
| **DashScope 返回 401/403** | API 密钥无效或已过期。使用 `node test-dashscope.mjs <密钥>` 进行诊断。 |
| **悬浮窗未显示** | 内容脚本无法注入受限页面（Chrome 网上应用店、`chrome://` 页面、PDF 查看器）。 |
| **"已有录制正在进行中"** | 另一个标签页正在录制。请先停止当前录制。 |

## 许可证

MIT
