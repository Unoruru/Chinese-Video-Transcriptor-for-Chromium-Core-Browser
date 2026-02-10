import { MSG } from '../utils/messages.js';
import { formatTime } from '../utils/constants.js';

// DOM elements
const tabTitleEl = document.getElementById('tab-title');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const timerEl = document.getElementById('timer');
const progressArea = document.getElementById('progress-area');
const progressStatus = document.getElementById('progress-status');
const progressPercent = document.getElementById('progress-percent');
const progressFill = document.getElementById('progress-fill');
const progressDetail = document.getElementById('progress-detail');
const resultArea = document.getElementById('result-area');
const resultText = document.getElementById('result-text');
const resultDetail = document.getElementById('result-detail');
const errorArea = document.getElementById('error-area');
const errorText = document.getElementById('error-text');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnSettings = document.getElementById('btn-settings');
const settingsPanel = document.getElementById('settings-panel');
const apiKeyInput = document.getElementById('api-key-input');
const btnToggleKey = document.getElementById('btn-toggle-key');
const btnSaveKey = document.getElementById('btn-save-key');
const btnClearKey = document.getElementById('btn-clear-key');
const apiStatus = document.getElementById('api-status');

let timerInterval = null;
let recordingStartTime = null;

// Get active tab info
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    tabTitleEl.textContent = tab.title || tab.url;
  }

  // Load API key status
  await loadApiKeyStatus();

  // Check if already recording
  const response = await chrome.runtime.sendMessage({ type: MSG.GET_STATUS });
  if (response?.recording) {
    const state = await chrome.storage.local.get('recordingState');
    if (state.recordingState) {
      if (state.recordingState.paused) {
        setPausedState(state.recordingState.pausedElapsedMs);
      } else {
        recordingStartTime = state.recordingState.startTime;
        setRecordingState();
      }
    }
  }
}

function setRecordingState() {
  statusIndicator.className = 'status-indicator recording';
  statusText.textContent = '录制中...';
  timerEl.style.display = 'block';
  timerEl.classList.remove('paused');
  btnStart.style.display = 'none';
  btnStop.style.display = 'block';
  btnPause.style.display = 'block';
  btnResume.style.display = 'none';
  progressArea.style.display = 'none';
  resultArea.style.display = 'none';
  errorArea.style.display = 'none';

  // Start timer
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function setPausedState(elapsedMs) {
  statusIndicator.className = 'status-indicator paused';
  statusText.textContent = '已暂停';
  timerEl.style.display = 'block';
  timerEl.classList.add('paused');
  timerEl.textContent = formatTime(elapsedMs / 1000);
  btnStart.style.display = 'none';
  btnStop.style.display = 'block';
  btnPause.style.display = 'none';
  btnResume.style.display = 'block';
  progressArea.style.display = 'none';
  resultArea.style.display = 'none';
  errorArea.style.display = 'none';

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function setTranscribingState() {
  statusIndicator.className = 'status-indicator transcribing';
  statusText.textContent = '转录中...';
  timerEl.style.display = 'none';
  timerEl.classList.remove('paused');
  btnStart.style.display = 'none';
  btnStop.style.display = 'none';
  btnStop.disabled = true;
  btnPause.style.display = 'none';
  btnResume.style.display = 'none';
  progressArea.style.display = 'block';
  resultArea.style.display = 'none';
  errorArea.style.display = 'none';

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function setIdleState() {
  statusIndicator.className = 'status-indicator idle';
  statusText.textContent = '就绪';
  timerEl.style.display = 'none';
  timerEl.classList.remove('paused');
  btnStart.style.display = 'block';
  btnStart.disabled = false;
  btnStop.style.display = 'none';
  btnPause.style.display = 'none';
  btnResume.style.display = 'none';
  progressArea.style.display = 'none';
  errorArea.style.display = 'none';

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimer() {
  if (!recordingStartTime) return;
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  timerEl.textContent = formatTime(elapsed);
}

function updateProgress(progress, status, detail) {
  progressFill.style.width = `${progress}%`;
  progressPercent.textContent = `${Math.round(progress)}%`;
  if (status) progressStatus.textContent = status;
  if (detail) {
    progressDetail.textContent = detail;
  }
}

// Button handlers
btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  errorArea.style.display = 'none';
  resultArea.style.display = 'none';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showError('无法获取当前标签页');
    btnStart.disabled = false;
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: MSG.START_RECORDING,
    tabId: tab.id,
  });

  if (response?.success) {
    recordingStartTime = Date.now();
    setRecordingState();
  } else {
    showError(response?.error || '启动录制失败');
    btnStart.disabled = false;
  }
});

btnStop.addEventListener('click', async () => {
  btnStop.disabled = true;
  setTranscribingState();

  const response = await chrome.runtime.sendMessage({
    type: MSG.STOP_RECORDING,
  });

  if (!response?.success) {
    showError(response?.error || '停止录制失败');
    setIdleState();
  }
});

btnPause.addEventListener('click', async () => {
  btnPause.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: MSG.PAUSE_RECORDING,
  });
  btnPause.disabled = false;
  if (!response?.success) {
    showError(response?.error || '暂停失败');
  }
});

btnResume.addEventListener('click', async () => {
  btnResume.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: MSG.RESUME_RECORDING,
  });
  btnResume.disabled = false;
  if (!response?.success) {
    showError(response?.error || '继续失败');
  }
});

function showError(msg) {
  errorArea.style.display = 'block';
  errorText.textContent = msg;
}

// Listen for messages from background/offscreen
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.STATUS_UPDATE) {
    if (message.state === 'paused') {
      setPausedState(message.pausedElapsedMs);
    } else if (message.state === 'recording') {
      recordingStartTime = message.startTime;
      setRecordingState();
    }
  }

  if (message.type === MSG.RECORDING_STARTED) {
    setRecordingState();
  }

  if (message.type === MSG.MODEL_DOWNLOAD_PROGRESS) {
    setTranscribingState();
    let detail = '';
    if (message.loaded && message.total) {
      const loadedMB = (message.loaded / 1024 / 1024).toFixed(1);
      const totalMB = (message.total / 1024 / 1024).toFixed(1);
      detail = `${loadedMB} / ${totalMB} MB — ${message.file || ''}`;
    }
    updateProgress(message.progress, message.status, detail);
  }

  if (message.type === MSG.TRANSCRIPTION_PROGRESS) {
    setTranscribingState();
    updateProgress(message.progress, message.status);
  }

  if (message.type === MSG.TRANSCRIPTION_COMPLETE) {
    statusIndicator.className = 'status-indicator complete';
    statusText.textContent = '完成';
    progressArea.style.display = 'none';
    resultArea.style.display = 'block';
    resultText.textContent = '转录完成！';
    resultDetail.textContent = `文件: ${message.filename} | 分段: ${message.segmentCount} | 时长: ${formatTime(message.duration)}`;
    btnStart.style.display = 'block';
    btnStart.disabled = false;
    btnStop.style.display = 'none';
    btnPause.style.display = 'none';
    btnResume.style.display = 'none';

    // Auto-reset after 5 seconds
    setTimeout(setIdleState, 5000);
  }

  if (message.type === MSG.ERROR) {
    showError(message.error);
    setIdleState();
  }

  return false;
});

// Settings panel handlers
btnSettings.addEventListener('click', () => {
  const isExpanded = btnSettings.getAttribute('aria-expanded') === 'true';
  btnSettings.setAttribute('aria-expanded', String(!isExpanded));
  settingsPanel.style.display = isExpanded ? 'none' : 'block';
});

btnSaveKey.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  await chrome.storage.local.set({ dashscopeApiKey: key });
  apiKeyInput.value = '';
  updateApiStatus(true);
});

btnClearKey.addEventListener('click', async () => {
  await chrome.storage.local.remove('dashscopeApiKey');
  apiKeyInput.value = '';
  updateApiStatus(false);
});

btnToggleKey.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  btnToggleKey.setAttribute('aria-label', isPassword ? '隐藏密钥' : '显示密钥');
});

async function loadApiKeyStatus() {
  const data = await chrome.storage.local.get('dashscopeApiKey');
  updateApiStatus(Boolean(data.dashscopeApiKey));
}

function updateApiStatus(configured) {
  if (configured) {
    apiStatus.textContent = '云端转录已启用';
    apiStatus.className = 'api-status configured';
  } else {
    apiStatus.textContent = '使用本地Whisper模型';
    apiStatus.className = 'api-status not-configured';
  }
}

init();
