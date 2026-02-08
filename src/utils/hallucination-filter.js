/**
 * Filter out common Whisper hallucinations and repetition artifacts
 * from transcription segments.
 */

const HALLUCINATION_PATTERNS = [
  /^[，。！？、：；""''…\s]+$/,          // punctuation-only segments
  /字幕由.*提供/,
  /字幕.*制作/,
  /本字幕.*仅供/,
  /谢谢观看/,
  /感谢收看/,
  /感谢观看/,
  /请不吝点赞/,
  /订阅/,
  /thanks?\s*for\s*watching/i,
  /subtitles?\s*by/i,
  /please\s*subscribe/i,
  /https?:\/\/\S+/,                     // URLs
  /www\.\S+/,
];

/**
 * Check if a segment's text matches a known hallucination pattern.
 */
function isKnownHallucination(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Detect internal repetition: any 4+ character substring appearing 3+ times.
 */
function hasInternalRepetition(text) {
  const minLen = 4;
  const minCount = 3;
  const trimmed = text.trim();
  if (trimmed.length < minLen * minCount) return false;

  for (let len = minLen; len <= Math.floor(trimmed.length / minCount); len++) {
    for (let start = 0; start <= trimmed.length - len; start++) {
      const sub = trimmed.substring(start, start + len);
      let count = 0;
      let idx = 0;
      while ((idx = trimmed.indexOf(sub, idx)) !== -1) {
        count++;
        if (count >= minCount) return true;
        idx += 1;
      }
    }
  }
  return false;
}

/**
 * Compute character-level similarity ratio between two strings.
 */
function charSimilarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length < b.length ? a : b;
  let matches = 0;
  const used = new Set();
  for (const ch of shorter) {
    for (let i = 0; i < longer.length; i++) {
      if (!used.has(i) && longer[i] === ch) {
        matches++;
        used.add(i);
        break;
      }
    }
  }
  return matches / longer.length;
}

/**
 * Filter an array of transcription segments.
 * Each segment is expected to have { text, timestamp }.
 * Returns a new array with hallucinated/repeated segments removed.
 */
export function filterHallucinations(segments) {
  const filtered = [];
  let prevText = '';

  for (const seg of segments) {
    const text = seg.text.trim();

    // Skip known hallucinations
    if (isKnownHallucination(text)) continue;

    // Skip segments with heavy internal repetition
    if (hasInternalRepetition(text)) continue;

    // Skip consecutive near-duplicates (>80% similarity)
    if (prevText && charSimilarity(text, prevText) > 0.8) continue;

    filtered.push(seg);
    prevText = text;
  }

  return filtered;
}
