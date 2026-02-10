import { MSG } from '../utils/messages.js';

let recordingTabId = null;
let statusTabId = null;
let isPaused = false;
let pausedElapsedMs = 0;

// Restore in-memory state from storage when service worker wakes up
const restoreStatePromise = chrome.storage.local.get('recordingState').then((data) => {
  if (data.recordingState) {
    recordingTabId = data.recordingState.tabId;
    statusTabId = data.recordingState.tabId;
    isPaused = data.recordingState.paused || false;
    pausedElapsedMs = data.recordingState.pausedElapsedMs || 0;
  }
});

// Badge helper
function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/offscreen/offscreen.html'),
    reasons: ['USER_MEDIA'],
    justification: 'Recording tab audio and running Whisper transcription',
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.START_RECORDING) {
    handleStartRecording(message.tabId).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // async response
  }

  if (message.type === MSG.STOP_RECORDING) {
    handleStopRecording().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === MSG.PAUSE_RECORDING) {
    handlePauseRecording().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === MSG.RESUME_RECORDING) {
    handleResumeRecording().then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (message.type === MSG.GET_STATUS) {
    restoreStatePromise.then(() => {
      sendResponse({
        recording: recordingTabId !== null,
        tabId: recordingTabId,
        paused: isPaused,
        pausedElapsedMs,
      });
    });
    return true; // async response
  }

  // Handle file download request from offscreen document
  if (message.type === MSG.DOWNLOAD_FILE) {
    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(message.markdown);
    chrome.downloads.download({
      url: dataUrl,
      filename: message.filename,
      saveAs: false,
    });
    return false;
  }

  // Forward progress messages from offscreen to popup
  if (
    message.type === MSG.MODEL_DOWNLOAD_PROGRESS ||
    message.type === MSG.TRANSCRIPTION_PROGRESS ||
    message.type === MSG.TRANSCRIPTION_COMPLETE ||
    message.type === MSG.ERROR ||
    message.type === MSG.RECORDING_STARTED
  ) {
    // Broadcast to all extension views (popup will receive it)
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup may be closed, that's fine
    });

    // Forward transcription/model progress to content script overlay
    if (
      (message.type === MSG.TRANSCRIPTION_PROGRESS || message.type === MSG.MODEL_DOWNLOAD_PROGRESS) &&
      statusTabId
    ) {
      chrome.tabs.sendMessage(statusTabId, {
        type: MSG.CONTENT_STATUS_UPDATE,
        state: 'transcribing',
        progress: message.progress,
      }).catch(() => {});
    }

    // Handle completion and error states
    if (message.type === MSG.TRANSCRIPTION_COMPLETE) {
      setBadge('✓', '#43a047');
      if (statusTabId) {
        chrome.tabs.sendMessage(statusTabId, {
          type: MSG.CONTENT_STATUS_UPDATE,
          state: 'complete',
        }).catch(() => {});
        statusTabId = null;
      }
      // Clear badge after 5 seconds
      setTimeout(() => setBadge('', '#000'), 5000);
    }

    if (message.type === MSG.ERROR) {
      setBadge('!', '#e53935');
      if (statusTabId) {
        chrome.tabs.sendMessage(statusTabId, {
          type: MSG.CONTENT_STATUS_UPDATE,
          state: 'error',
        }).catch(() => {});
        statusTabId = null;
      }
      // Clear badge after 5 seconds
      setTimeout(() => setBadge('', '#000'), 5000);
    }

    return false;
  }

  return false;
});

async function handlePauseRecording() {
  await restoreStatePromise;
  if (recordingTabId === null || isPaused) {
    throw new Error('无法暂停');
  }

  await chrome.runtime.sendMessage({ type: MSG.OFFSCREEN_PAUSE_RECORDING });

  // Compute elapsed time at pause moment
  const state = await chrome.storage.local.get('recordingState');
  const startTime = state.recordingState?.startTime || Date.now();
  pausedElapsedMs = Date.now() - startTime;
  isPaused = true;

  await chrome.storage.local.set({
    recordingState: { ...state.recordingState, paused: true, pausedElapsedMs },
  });

  setBadge('||', '#1565c0');

  // Notify content script
  if (statusTabId) {
    chrome.tabs.sendMessage(statusTabId, {
      type: MSG.CONTENT_STATUS_UPDATE,
      state: 'paused',
      pausedElapsedMs,
    }).catch(() => {});
  }

  // Broadcast to popup
  chrome.runtime.sendMessage({
    type: MSG.STATUS_UPDATE,
    state: 'paused',
    pausedElapsedMs,
  }).catch(() => {});

  return { success: true };
}

async function handleResumeRecording() {
  await restoreStatePromise;
  if (recordingTabId === null || !isPaused) {
    throw new Error('无法继续');
  }

  await chrome.runtime.sendMessage({ type: MSG.OFFSCREEN_RESUME_RECORDING });

  // Adjust startTime so elapsed calculation continues seamlessly
  const newStartTime = Date.now() - pausedElapsedMs;
  isPaused = false;
  pausedElapsedMs = 0;

  const state = await chrome.storage.local.get('recordingState');
  await chrome.storage.local.set({
    recordingState: { ...state.recordingState, startTime: newStartTime, paused: false, pausedElapsedMs: 0 },
  });

  setBadge('REC', '#e53935');

  // Notify content script
  if (statusTabId) {
    chrome.tabs.sendMessage(statusTabId, {
      type: MSG.CONTENT_STATUS_UPDATE,
      state: 'recording',
      startTime: newStartTime,
    }).catch(() => {});
  }

  // Broadcast to popup
  chrome.runtime.sendMessage({
    type: MSG.STATUS_UPDATE,
    state: 'recording',
    startTime: newStartTime,
  }).catch(() => {});

  return { success: true };
}

async function handleStartRecording(tabId) {
  if (recordingTabId !== null) {
    throw new Error('已有录制正在进行中');
  }

  // Get tab info
  const tab = await chrome.tabs.get(tabId);

  // Get media stream ID for tab capture
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  });

  // Ensure offscreen document exists
  await ensureOffscreenDocument();

  // Read DashScope API key so we can pass it explicitly to offscreen
  const keyData = await chrome.storage.local.get('dashscopeApiKey');
  const apiKey = keyData.dashscopeApiKey || '';

  // Send to offscreen document to start recording
  await chrome.runtime.sendMessage({
    type: MSG.OFFSCREEN_START_RECORDING,
    streamId,
    tabTitle: tab.title || 'Untitled',
    tabUrl: tab.url || '',
    apiKey,
  });

  recordingTabId = tabId;
  statusTabId = tabId;
  isPaused = false;
  pausedElapsedMs = 0;
  const startTime = Date.now();
  await chrome.storage.local.set({
    recordingState: { tabId, tabTitle: tab.title, startTime },
  });

  // Set badge
  setBadge('REC', '#e53935');

  // Inject content script for status overlay
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    // Send initial state
    await chrome.tabs.sendMessage(tabId, {
      type: MSG.CONTENT_STATUS_UPDATE,
      state: 'recording',
      startTime,
    });
  } catch (err) {
    // Content script injection may fail on restricted pages (chrome://, etc.)
    console.warn('[Background] Could not inject content script:', err.message);
  }

  return { success: true };
}

async function handleStopRecording() {
  await restoreStatePromise;
  if (recordingTabId === null) {
    throw new Error('没有正在进行的录制');
  }

  const tabId = recordingTabId;

  await chrome.runtime.sendMessage({
    type: MSG.OFFSCREEN_STOP_RECORDING,
  });

  recordingTabId = null;
  isPaused = false;
  pausedElapsedMs = 0;
  await chrome.storage.local.remove('recordingState');

  // Set badge to transcribing state
  setBadge('...', '#fb8c00');

  // Update content script overlay
  if (statusTabId) {
    try {
      await chrome.tabs.sendMessage(statusTabId, {
        type: MSG.CONTENT_STATUS_UPDATE,
        state: 'transcribing',
      });
    } catch (err) {
      // Tab may be closed or content script not injected
    }
  }

  return { success: true };
}

// Auto-stop if recording tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId) {
    handleStopRecording().catch(console.error);
  }
  if (tabId === statusTabId) {
    statusTabId = null;
    setBadge('', '#000');
  }
});
