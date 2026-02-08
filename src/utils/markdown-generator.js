import { formatTime, WHISPER_MODEL } from './constants.js';

export function generateMarkdown({ title, url, duration, language, segments }) {
  const now = new Date().toISOString();
  const durationStr = formatTime(duration);

  const fullText = segments.map(s => s.text.trim()).join('');

  let md = `---
title: "${title}"
source: "${url}"
duration: "${durationStr}"
transcribed_at: "${now}"
language: "${language || 'zh'}"
model: "${WHISPER_MODEL}"
---

# ${title}

## 完整文本

${fullText}

## 带时间戳的分段

`;

  for (const seg of segments) {
    const start = formatTime(seg.timestamp[0]);
    const end = seg.timestamp[1] != null ? formatTime(seg.timestamp[1]) : durationStr;
    md += `**[${start} - ${end}]** ${seg.text.trim()}\n\n`;
  }

  return md;
}
