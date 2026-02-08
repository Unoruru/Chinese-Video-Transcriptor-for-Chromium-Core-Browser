# Chinese Video Auto-Transcriptor

A web-based application that automatically transcribes Chinese-language videos and exports transcripts in AI-optimized formats.

## Project Overview

This tool allows users to:
- Input video URLs or upload video files
- Automatically transcribe Chinese speech to text
- Export transcripts in structured formats optimized for AI consumption
- Configure custom storage directories for transcript files

## Technical Requirements

### Core Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Video Input | Accept URL (YouTube, Bilibili, etc.) or file upload | P0 |
| Chinese ASR | Accurate Mandarin speech recognition | P0 |
| Transcript Export | Save as `.md` or `.json` with video title as filename | P0 |
| Custom Storage Path | User-configurable output directory | P0 |
| Web Interface | Clean, responsive UI | P1 |

### Technology Stack

```
Frontend:  React + TypeScript + Tailwind CSS
Backend:   Python (FastAPI)
ASR:       OpenAI Whisper (large-v3) - best for Chinese
Storage:   Local filesystem with configurable paths
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Web Interface                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Video Input │  │  Progress   │  │  Storage Settings   │  │
│  │   (URL/File)│  │   Display   │  │  (Path Configuration)│ │
│  └──────┬──────┘  └──────▲──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼───────────────────┼──────────────┘
          │                │                   │
          ▼                │                   ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend API (FastAPI)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Video       │  │ Transcription│ │  File Manager       │  │
│  │ Downloader  │──▶│ Engine      │──▶│  (Save/Export)      │  │
│  │ (yt-dlp)    │  │ (Whisper)   │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
video-transcriptor/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── VideoInput.tsx       # URL/file upload component
│   │   │   ├── TranscriptViewer.tsx # Display transcript
│   │   │   ├── ProgressBar.tsx      # Transcription progress
│   │   │   └── SettingsPanel.tsx    # Storage path config
│   │   ├── hooks/
│   │   │   └── useTranscription.ts  # API interaction hook
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point
│   │   ├── routers/
│   │   │   ├── transcribe.py        # Transcription endpoints
│   │   │   └── settings.py          # Storage settings endpoints
│   │   ├── services/
│   │   │   ├── video_downloader.py  # yt-dlp integration
│   │   │   ├── transcriber.py       # Whisper integration
│   │   │   └── file_manager.py      # File operations
│   │   ├── models/
│   │   │   └── schemas.py           # Pydantic models
│   │   └── config.py                # App configuration
│   ├── requirements.txt
│   └── Dockerfile
├── config/
│   └── settings.json                # User settings (storage path)
├── docker-compose.yml
└── README.md
```

## API Specification

### Endpoints

#### POST `/api/transcribe`
Start transcription job.

```json
// Request
{
  "source": "https://www.bilibili.com/video/BV1xxx" | File,
  "source_type": "url" | "file"
}

// Response
{
  "job_id": "uuid",
  "status": "processing",
  "video_title": "视频标题"
}
```

#### GET `/api/transcribe/{job_id}/status`
Check transcription progress.

```json
// Response
{
  "job_id": "uuid",
  "status": "processing" | "completed" | "failed",
  "progress": 75,
  "message": "Transcribing audio..."
}
```

#### GET `/api/transcribe/{job_id}/result`
Get completed transcript.

```json
// Response
{
  "job_id": "uuid",
  "video_title": "视频标题",
  "transcript": {
    "full_text": "...",
    "segments": [
      {"start": 0.0, "end": 2.5, "text": "大家好"},
      {"start": 2.5, "end": 5.0, "text": "欢迎收看"}
    ]
  },
  "file_path": "/transcripts/视频标题.md"
}
```

#### GET `/api/settings`
Get current settings.

```json
// Response
{
  "storage_path": "/Users/username/Documents/transcripts",
  "output_format": "md"
}
```

#### PUT `/api/settings`
Update settings.

```json
// Request
{
  "storage_path": "/new/path/to/transcripts",
  "output_format": "md" | "json"
}
```

## Output Format Specification

### Markdown Format (Recommended for AI)

Filename: `{video_title}.md`

```markdown
---
title: 视频标题
source: https://example.com/video
duration: 1234
transcribed_at: 2024-01-15T10:30:00Z
language: zh-CN
---

# 视频标题

## Transcript

[00:00:00] 大家好，欢迎收看今天的节目。

[00:00:05] 今天我们要讨论的话题是...

[00:00:12] 首先，让我们来看一下背景信息。

## Segments

| Timestamp | Text |
|-----------|------|
| 00:00:00 - 00:00:05 | 大家好，欢迎收看今天的节目。 |
| 00:00:05 - 00:00:12 | 今天我们要讨论的话题是... |
```

### JSON Format (Alternative)

Filename: `{video_title}.json`

```json
{
  "metadata": {
    "title": "视频标题",
    "source": "https://example.com/video",
    "duration": 1234,
    "transcribed_at": "2024-01-15T10:30:00Z",
    "language": "zh-CN"
  },
  "transcript": {
    "full_text": "大家好，欢迎收看今天的节目。今天我们要讨论的话题是...",
    "segments": [
      {
        "id": 1,
        "start": 0.0,
        "end": 5.0,
        "text": "大家好，欢迎收看今天的节目。"
      },
      {
        "id": 2,
        "start": 5.0,
        "end": 12.0,
        "text": "今天我们要讨论的话题是..."
      }
    ]
  }
}
```

## Implementation Guide

### Phase 1: Backend Core (Day 1-2)

1. **Set up FastAPI project structure**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate
   pip install fastapi uvicorn whisper yt-dlp pydantic python-multipart
   ```

2. **Implement video downloader service**
   - Use `yt-dlp` for URL downloads (supports YouTube, Bilibili, etc.)
   - Extract video title for filename
   - Convert to audio format for Whisper

3. **Implement transcription service**
   - Load Whisper `large-v3` model
   - Configure for Chinese: `whisper.transcribe(audio, language="zh")`
   - Return timestamped segments

4. **Implement file manager service**
   - Sanitize filenames (remove invalid characters)
   - Write to configurable directory
   - Support both `.md` and `.json` formats

### Phase 2: Frontend (Day 2-3)

1. **Set up React + Vite project**
   ```bash
   cd frontend
   npm create vite@latest . -- --template react-ts
   npm install axios tailwindcss
   ```

2. **Build components**
   - Video input with drag-drop file upload
   - Real-time progress indicator
   - Transcript preview
   - Settings panel with directory picker

### Phase 3: Integration (Day 3-4)

1. **Connect frontend to backend API**
2. **Add WebSocket for real-time progress updates**
3. **Implement error handling and retry logic**
4. **Add loading states and user feedback**

### Phase 4: Polish (Day 4-5)

1. **Docker containerization**
2. **Add batch processing support**
3. **Implement transcript editing**
4. **Performance optimization**

## Key Implementation Details

### Chinese ASR Configuration

```python
# backend/app/services/transcriber.py
import whisper

class Transcriber:
    def __init__(self):
        # Use large-v3 for best Chinese accuracy
        self.model = whisper.load_model("large-v3")
    
    def transcribe(self, audio_path: str) -> dict:
        result = self.model.transcribe(
            audio_path,
            language="zh",           # Force Chinese
            task="transcribe",
            verbose=False,
            initial_prompt="以下是普通话的句子。"  # Helps with accuracy
        )
        return result
```

### Filename Sanitization

```python
# backend/app/services/file_manager.py
import re
import unicodedata

def sanitize_filename(title: str) -> str:
    """Create safe filename from video title, preserving Chinese characters."""
    # Normalize unicode
    title = unicodedata.normalize('NFKC', title)
    # Remove invalid filename characters
    title = re.sub(r'[<>:"/\\|?*]', '', title)
    # Trim whitespace and limit length
    title = title.strip()[:200]
    return title or "untitled"
```

### Storage Path Configuration

```python
# backend/app/config.py
from pydantic import BaseSettings
from pathlib import Path

class Settings(BaseSettings):
    storage_path: Path = Path.home() / "Documents" / "transcripts"
    output_format: str = "md"  # or "json"
    
    class Config:
        env_file = ".env"

# Persist user settings
def save_settings(settings: dict):
    config_path = Path("config/settings.json")
    config_path.parent.mkdir(exist_ok=True)
    with open(config_path, "w") as f:
        json.dump(settings, f, indent=2)
```

## Running the Application

### Development

```bash
# Terminal 1: Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

### Production (Docker)

```bash
docker-compose up -d
```

Access at `http://localhost:3000`

## Environment Variables

```env
# backend/.env
WHISPER_MODEL=large-v3
DEFAULT_STORAGE_PATH=/app/transcripts
MAX_UPLOAD_SIZE_MB=500
CUDA_VISIBLE_DEVICES=0  # For GPU acceleration
```

## Testing Checklist

- [ ] Transcribe video from YouTube URL
- [ ] Transcribe video from Bilibili URL
- [ ] Transcribe uploaded video file
- [ ] Verify Chinese transcription accuracy
- [ ] Test filename with special characters (中文标题!@#)
- [ ] Change storage directory and verify files save correctly
- [ ] Test with long videos (>1 hour)
- [ ] Test concurrent transcription jobs
- [ ] Verify `.md` output format
- [ ] Verify `.json` output format

## Error Handling

| Error | User Message | Resolution |
|-------|--------------|------------|
| Invalid URL | "Could not access video. Please check the URL." | Validate URL format, check video availability |
| Download failed | "Failed to download video. The video may be private or region-locked." | Retry with different extractor |
| Transcription failed | "Transcription failed. Please try again." | Log error, offer retry |
| Storage path invalid | "Cannot write to selected directory. Please choose another location." | Verify permissions, suggest default |

## Performance Considerations

1. **GPU Acceleration**: Use CUDA for 10x faster transcription
2. **Model Caching**: Keep Whisper model loaded in memory
3. **Chunked Processing**: Stream large files instead of loading entirely
4. **Background Jobs**: Use Celery/Redis for async processing

## Security Notes

- Sanitize all filenames before writing to disk
- Validate storage paths to prevent directory traversal
- Limit upload file sizes
- Clean up temporary files after processing

## Future Enhancements

- [ ] Speaker diarization (identify different speakers)
- [ ] Subtitle export (SRT/VTT)
- [ ] Translation to other languages
- [ ] Batch URL processing
- [ ] Cloud storage integration (S3, Google Drive)
- [ ] Transcript search and indexing
