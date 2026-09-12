let currentPreferences = null;
let completionSent = false;
let googleDriveProgressTimer = null;

function getVideo() {
  return document.querySelector('video');
}

function isGoogleDriveFrame() {
  if (typeof location === 'undefined') return false;
  return location.hostname === 'drive.google.com' || location.hostname.endsWith('.drive.google.com');
}

function getGoogleDriveTimeline() {
  if (!isGoogleDriveFrame()) return null;
  if (typeof document.querySelectorAll !== 'function') return null;
  return [...document.querySelectorAll('input[type="range"]')]
    .find((control) => Number(control.max) > 1000) ?? null;
}

function parsePlaybackRate(value) {
  const match = String(value ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function getGoogleDriveSpeedButton() {
  if (typeof document.querySelectorAll !== 'function') return null;
  return [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((button) => {
    const rate = parsePlaybackRate(button.getAttribute?.('aria-label') || button.textContent);
    return Number.isFinite(rate) && rate >= 0.1 && rate <= 4;
  }) ?? null;
}

function getGoogleDriveSpeedOption(speedButton, playbackRate) {
  const menuContainer = speedButton.closest?.('[data-is-menu-dynamic="true"]');
  if (typeof menuContainer?.querySelectorAll !== 'function') return null;
  return [...menuContainer.querySelectorAll('[role="menuitemradio"]')]
    .find((option) => parsePlaybackRate(option.textContent) === playbackRate) ?? null;
}

function sendRuntimeMessage(message) {
  if (typeof chrome?.runtime?.sendMessage !== 'function') return;
  chrome.runtime.sendMessage(message);
}

function emit(event, detail) {
  sendRuntimeMessage({ type: 'ONEPACE_PLAYER_EVENT', event, detail });
}

function shouldFinishPlayback(video, eventType) {
  if (eventType === 'ended') return true;
  const duration = Number(video?.duration);
  const currentTime = Number(video?.currentTime);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const remaining = duration - currentTime;
  return (eventType === 'waiting' || eventType === 'stalled') && remaining >= 0 && remaining <= 5;
}

function emitCompletion(video, eventType) {
  if (completionSent || !shouldFinishPlayback(video, eventType)) return;
  completionSent = true;
  emit('ended', { durationSeconds: Math.floor(video.duration || 0) });
}

function dispatchControlChange(control) {
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function applyGoogleDrivePreferences() {
  if (!isGoogleDriveFrame() || getVideo()) return;
  if (!currentPreferences) return;
  const timeline = getGoogleDriveTimeline();
  if (timeline && Object.hasOwn(currentPreferences, 'startAtSeconds') && !timeline.dataset.onepaceUtilitiesStartApplied) {
    const startAt = Number(currentPreferences.startAtSeconds) || 0;
    const durationMilliseconds = Number(timeline.max);
    if (startAt > 0 && Number.isFinite(durationMilliseconds) && startAt * 1000 < durationMilliseconds - 1000) {
      timeline.value = String(Math.floor(startAt * 1000));
      timeline.dataset.onepaceUtilitiesStartApplied = 'true';
      dispatchControlChange(timeline);
    }
  }

  const playbackRate = Number(currentPreferences.playbackRate) || 1;
  const speedButton = getGoogleDriveSpeedButton();
  if (!speedButton) return;
  const currentRate = parsePlaybackRate(speedButton.getAttribute?.('aria-label') || speedButton.textContent);
  if (currentRate === playbackRate) return;
  const option = getGoogleDriveSpeedOption(speedButton, playbackRate);
  if (option) {
    option.click();
    return;
  }
  if (speedButton.getAttribute?.('aria-expanded') !== 'true') speedButton.click();
}

function stopGoogleDriveProgress() {
  if (googleDriveProgressTimer === null) return;
  clearInterval(googleDriveProgressTimer);
  googleDriveProgressTimer = null;
}

function reportGoogleDriveProgress() {
  if (!currentPreferences) return;
  const timeline = getGoogleDriveTimeline();
  if (!timeline) return;
  const currentTime = Number(timeline.value) / 1000;
  const duration = Number(timeline.max) / 1000;
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return;
  emit('position', {
    positionSeconds: Math.floor(currentTime),
    durationSeconds: Math.floor(duration)
  });
  if (duration - currentTime >= 0 && duration - currentTime <= 0.25) {
    emitCompletion({ currentTime, duration }, 'ended');
  }
}

function bindGoogleDrivePlayer() {
  if (!getGoogleDriveTimeline()) {
    stopGoogleDriveProgress();
    return;
  }
  applyGoogleDrivePreferences();
  if (googleDriveProgressTimer === null) {
    googleDriveProgressTimer = setInterval(reportGoogleDriveProgress, 1000);
  }
}

function applyPreferences(video) {
  if (!video || !currentPreferences) return;
  video.playbackRate = Number(currentPreferences.playbackRate) || 1;
  if (!Object.hasOwn(currentPreferences, 'startAtSeconds')) return;
  if (video.dataset.onepaceUtilitiesStartApplied) return;
  const startAt = Number(currentPreferences.startAtSeconds) || 0;
  if (startAt > 0 && Number.isFinite(video.duration) && startAt < video.duration - 1) {
    video.currentTime = startAt;
    video.dataset.onepaceUtilitiesStartApplied = 'true';
  }
}

function bindVideo(video) {
  if (!video || video.dataset.onepaceUtilitiesBound) return;
  video.dataset.onepaceUtilitiesBound = 'true';
  video.addEventListener('loadedmetadata', () => applyPreferences(video));
  video.addEventListener('timeupdate', () => {
    if (!currentPreferences) return;
    emit('position', {
      positionSeconds: Math.floor(video.currentTime),
      durationSeconds: Math.floor(video.duration || 0)
    });
  });
  video.addEventListener('ended', () => emitCompletion(video, 'ended'));
  video.addEventListener('waiting', () => emitCompletion(video, 'waiting'));
  video.addEventListener('stalled', () => emitCompletion(video, 'stalled'));
  applyPreferences(video);
}

function bindPlayer() {
  const video = getVideo();
  if (video) {
    stopGoogleDriveProgress();
    bindVideo(video);
    return;
  }
  if (isGoogleDriveFrame()) {
    bindGoogleDrivePlayer();
    return;
  }
  stopGoogleDriveProgress();
}

new MutationObserver(bindPlayer).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['value', 'aria-valuetext', 'aria-expanded', 'aria-checked']
});
bindPlayer();
sendRuntimeMessage({ type: 'ONEPACE_PLAYER_READY' });

if (typeof chrome?.runtime?.onMessage?.addListener === 'function') {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'ONEPACE_PLAYER_PREFERENCES') return;
    currentPreferences = message.payload;
    bindPlayer();
    applyPreferences(getVideo());
    applyGoogleDrivePreferences();
  });
}
