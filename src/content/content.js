(function() {
  'use strict';

  const CONTAINER_ID = '__transcriptor_status_overlay__';

  // Double-injection guard
  if (document.getElementById(CONTAINER_ID)) return;

  // Create container with Shadow DOM for CSS isolation
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  const shadow = container.attachShadow({ mode: 'closed' });

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .overlay {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 2147483647;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
      transition: opacity 0.3s, transform 0.3s, background 0.3s;
      opacity: 1;
      transform: translateY(0);
    }
    .overlay.hidden {
      opacity: 0;
      transform: translateY(-20px);
      pointer-events: none;
    }
    .overlay.recording {
      background: linear-gradient(135deg, #e53935, #c62828);
    }
    .overlay.paused {
      background: linear-gradient(135deg, #1565c0, #0d47a1);
    }
    .overlay.transcribing {
      background: linear-gradient(135deg, #fb8c00, #ef6c00);
    }
    .overlay.complete {
      background: linear-gradient(135deg, #43a047, #2e7d32);
    }
    .overlay.error {
      background: linear-gradient(135deg, #e53935, #b71c1c);
    }
    .error-panel {
      position: fixed;
      top: 52px;
      right: 12px;
      z-index: 2147483647;
      max-width: 420px;
      max-height: 300px;
      background: rgba(30, 30, 30, 0.95);
      border: 1px solid #e53935;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #fff;
      display: flex;
      flex-direction: column;
    }
    .error-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      font-size: 13px;
      font-weight: 600;
      color: #ef9a9a;
    }
    .error-panel-close {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .error-panel-close:hover {
      background: rgba(255,255,255,0.15);
    }
    .error-panel-close:focus-visible {
      outline: 2px solid #fff;
      outline-offset: -2px;
    }
    .error-panel-body {
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
      overflow-y: auto;
      word-break: break-word;
      user-select: text;
      -webkit-user-select: text;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #fff;
    }
    .recording .dot {
      animation: pulse 1s infinite;
    }
    .transcribing .dot {
      animation: pulse 0.6s infinite;
    }
    .paused .dot {
      opacity: 0.7;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .timer {
      font-variant-numeric: tabular-nums;
      min-width: 48px;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 4px;
    }
    .ctrl-btn {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: rgba(255,255,255,0.2);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: background 0.15s;
    }
    .ctrl-btn:hover {
      background: rgba(255,255,255,0.35);
    }
    .ctrl-btn:active {
      background: rgba(255,255,255,0.5);
    }
    .ctrl-btn svg {
      width: 14px;
      height: 14px;
      fill: #fff;
    }
    .ctrl-btn.hidden {
      display: none;
    }
  `;

  // Overlay element
  const overlay = document.createElement('div');
  overlay.className = 'overlay recording';
  overlay.innerHTML = `
    <span class="dot"></span>
    <span class="status">录制中</span>
    <span class="timer">00:00</span>
    <span class="controls">
      <button class="ctrl-btn" id="btn-pause" title="暂停">
        <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
      <button class="ctrl-btn hidden" id="btn-resume" title="继续">
        <svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>
      </button>
      <button class="ctrl-btn" id="btn-finish" title="完成并转录">
        <svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
      </button>
    </span>
  `;

  shadow.appendChild(style);
  shadow.appendChild(overlay);
  document.body.appendChild(container);

  // Button references
  const btnPause = shadow.getElementById('btn-pause');
  const btnResume = shadow.getElementById('btn-resume');
  const btnFinish = shadow.getElementById('btn-finish');

  // State
  let startTime = Date.now();
  let timerInterval = null;

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function updateTimer() {
    const elapsed = Date.now() - startTime;
    overlay.querySelector('.timer').textContent = formatTime(elapsed);
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function setButtonVisibility(state) {
    const showPause = state === 'recording';
    const showResume = state === 'paused';
    const showFinish = state === 'recording' || state === 'paused';

    btnPause.classList.toggle('hidden', !showPause);
    btnResume.classList.toggle('hidden', !showResume);
    btnFinish.classList.toggle('hidden', !showFinish);
  }

  function setState(state, data = {}) {
    stopTimer();
    overlay.className = 'overlay ' + state;
    const statusEl = overlay.querySelector('.status');
    const timerEl = overlay.querySelector('.timer');

    setButtonVisibility(state);

    switch (state) {
      case 'recording':
        statusEl.textContent = '录制中';
        if (data.startTime) startTime = data.startTime;
        startTimer();
        break;
      case 'paused':
        statusEl.textContent = '已暂停';
        if (data.pausedElapsedMs) {
          timerEl.textContent = formatTime(data.pausedElapsedMs);
        }
        break;
      case 'transcribing':
        statusEl.textContent = '转录中...';
        timerEl.textContent = data.progress != null ? `${Math.round(data.progress)}%` : '';
        break;
      case 'complete':
        statusEl.textContent = '完成';
        timerEl.textContent = '✓';
        autoHide(3000);
        break;
      case 'error': {
        statusEl.textContent = '出错';
        timerEl.textContent = '✗';
        showErrorPanel(data.error || '未知错误');
        break;
      }
    }
  }

  function autoHide(delay) {
    setTimeout(() => {
      overlay.classList.add('hidden');
      setTimeout(() => {
        container.remove();
      }, 500);
    }, delay);
  }

  function showErrorPanel(errorMsg) {
    // Remove existing error panel if any
    const existing = shadow.querySelector('.error-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = 'error-panel';
    panel.setAttribute('role', 'alert');
    panel.innerHTML = `
      <div class="error-panel-header">
        <span>转录出错</span>
        <button class="error-panel-close" aria-label="关闭错误面板">&times;</button>
      </div>
      <div class="error-panel-body"></div>
    `;
    // Set error text via textContent to avoid XSS
    panel.querySelector('.error-panel-body').textContent = errorMsg;

    panel.querySelector('.error-panel-close').addEventListener('click', () => {
      panel.remove();
    });

    shadow.appendChild(panel);
  }

  // Click handlers
  btnPause.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
  });

  btnResume.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
  });

  btnFinish.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  });

  // --- Video seek detection: auto-pause/resume recording ---
  let seekPaused = false;
  let seekResumeTimer = null;

  function onVideoSeeking() {
    // Only auto-pause if currently recording (not already paused/transcribing/etc.)
    if (!overlay.classList.contains('recording')) return;

    // Clear any pending resume
    if (seekResumeTimer) {
      clearTimeout(seekResumeTimer);
      seekResumeTimer = null;
    }

    seekPaused = true;
    overlay.querySelector('.status').textContent = '跳转暂停';
    chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
  }

  function onVideoSeeked() {
    if (!seekPaused) return;

    // Debounce: wait 500ms before resuming (handles rapid seeks)
    if (seekResumeTimer) clearTimeout(seekResumeTimer);
    seekResumeTimer = setTimeout(() => {
      seekResumeTimer = null;
      if (seekPaused) {
        seekPaused = false;
        chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
      }
    }, 500);
  }

  function watchVideo(video) {
    video.addEventListener('seeking', onVideoSeeking);
    video.addEventListener('seeked', onVideoSeeked);
  }

  // Watch existing <video> elements
  document.querySelectorAll('video').forEach(watchVideo);

  // Watch for dynamically added <video> elements
  const videoObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName === 'VIDEO') {
          watchVideo(node);
        } else if (node.querySelectorAll) {
          node.querySelectorAll('video').forEach(watchVideo);
        }
      }
    }
  });
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Listen for status updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONTENT_STATUS_UPDATE') {
      // If user manually paused, don't auto-resume on seeked
      if (message.state === 'paused' && !seekPaused) {
        // Manual pause — clear any pending seek resume
        if (seekResumeTimer) {
          clearTimeout(seekResumeTimer);
          seekResumeTimer = null;
        }
      }
      if (message.state === 'recording') {
        seekPaused = false;
      }
      setState(message.state, message);
    }
  });

  // Start with recording state
  setButtonVisibility('recording');
  startTimer();
})();
