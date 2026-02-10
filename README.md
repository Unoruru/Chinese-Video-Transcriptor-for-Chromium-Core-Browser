# Chinese Video Auto-Transcriptor

Chrome extension (Manifest V3) that records audio from any browser tab and transcribes Chinese speech into timestamped Markdown files.

## Features

- **Dual transcription engines** -- local Whisper (via `@huggingface/transformers`) or cloud DashScope Paraformer
- **Pause / resume** recording at any time
- **Automatic Markdown export** with timestamps, video title, and source URL
- **Traditional-to-Simplified Chinese** conversion (OpenCC)
- **WebGPU acceleration** when available, WASM fallback otherwise
- **Hallucination filtering** to remove repeated or phantom segments

## Installation

### Build from source

```bash
git clone <repo-url>
cd video-transcriptor
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
4. Use **暂停** / **继续** to pause and resume.
5. Click **停止并转录** (Stop & Transcribe) when done.
6. A `.md` file downloads automatically with the timestamped transcript.

### Configuring DashScope (optional)

By default the extension transcribes locally using Whisper (first run downloads ~50 MB model). For faster cloud transcription:

1. Get an API key from [Alibaba Cloud DashScope](https://dashscope.aliyuncs.com/).
2. Click the gear icon in the popup.
3. Paste your API key and click **保存** (Save).

When a key is configured the extension uses DashScope Paraformer. If the cloud call fails it falls back to local Whisper automatically.

## Architecture

```
Popup (UI)  <──messages──>  Service Worker  <──messages──>  Offscreen Document
popup.js                    background.js                   offscreen.js
                                                            ├─ MediaRecorder (audio capture)
                                                            ├─ Whisper pipeline (local ASR)
                                                            └─ DashScope client (cloud ASR)
```

- **Popup** -- controls recording state, displays progress, manages settings.
- **Service Worker** -- routes messages, handles `chrome.tabCapture`, triggers downloads.
- **Offscreen Document** -- captures audio via `MediaRecorder`, runs transcription, generates Markdown.
- **Content Script** -- injects an overlay into the active tab showing recording status.

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Commands

```bash
npm install     # install dependencies
npm run dev     # start Vite dev server with HMR
npm run build   # production build to dist/
```

### Project structure

```
src/
├── assets/              # extension icons
├── background/
│   └── background.js    # service worker
├── content/
│   └── content.js       # content script (recording overlay)
├── offscreen/
│   ├── offscreen.html   # offscreen document entry
│   ├── offscreen.js     # audio capture + transcription
│   └── audio-processor.js  # WebM to Float32 audio conversion
├── popup/
│   ├── popup.html       # popup UI
│   ├── popup.css        # popup styles
│   └── popup.js         # popup logic
└── utils/
    ├── constants.js     # shared constants (model name, etc.)
    ├── dashscope.js     # DashScope Paraformer API client
    ├── hallucination-filter.js  # removes repeated/phantom segments
    ├── markdown-generator.js    # builds Markdown output
    └── messages.js      # message type constants
```

### Build tooling

| Tool | Purpose |
|------|---------|
| Vite 7 | Bundler |
| `@crxjs/vite-plugin` | Chrome extension dev support |
| `vite-plugin-static-copy` | Copies ONNX WASM files to build output |

## License

MIT
