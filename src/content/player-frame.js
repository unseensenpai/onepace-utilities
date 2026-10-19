let currentPreferences = null;
let completionSent = false;
let googleDriveProgressTimer = null;
const JW_PLAY_EVENT = 'onepace-utilities:jw-play';

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

// JW Player (AitrVip) keeps its own state: playing its bare <video> leaves the player idle, so the
// next click only wakes it up and a second one is needed. jwplayer-bridge.js starts it through the
// page's own jwplayer() API instead.
function startPlayback(video) {
  if (video.classList?.contains('jw-video')) {
    document.dispatchEvent(new CustomEvent(JW_PLAY_EVENT));
    return;
  }
  video.play()?.catch?.(() => undefined);
}

function applyPreferences(video) {
  if (!video || !currentPreferences) return;
  video.playbackRate = Number(currentPreferences.playbackRate) || 1;
  // Once per video; the browser may still refuse playback without a user gesture, which is fine.
  if (currentPreferences.autoplay && !video.dataset.onepaceUtilitiesAutoplayed && video.paused) {
    video.dataset.onepaceUtilitiesAutoplayed = 'true';
    startPlayback(video);
  }
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

// A transparent full-size ad layer over the player swallows the first click (and plays an ad sound).
const CLICK_TRAP_SELECTOR = '[class*="df-ovrly"]';

function removeClickTraps() {
  if (typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll(CLICK_TRAP_SELECTOR).forEach((element) => element.remove());
}

function bindPlayer() {
  removeClickTraps();
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

function seekVideo(seconds) {
  const video = getVideo();
  if (!video || !Number.isFinite(video.duration)) return;
  video.currentTime = Math.min(Math.max(0, video.currentTime + seconds), video.duration - 0.5);
}

const NEXT_PROMPT_ID = 'onepace-utilities-next';

// The page decides when to offer the next episode; the button lives in this frame so it stays
// visible when the player itself is fullscreen.
function showNextPrompt(label) {
  document.getElementById(NEXT_PROMPT_ID)?.remove();
  if (!label) return;
  const prompt = document.createElement('div');
  prompt.id = NEXT_PROMPT_ID;
  prompt.style.cssText = 'position:fixed;right:24px;bottom:72px;z-index:2147483647;display:flex;gap:4px;font:14px system-ui,sans-serif';
  const buttonStyle = 'background:rgba(23,27,33,.88);border:1px solid #45a9e8;border-radius:9px;color:#fff;cursor:pointer;font:inherit;padding:10px 14px';
  for (const [action, text] of [['next', label], ['dismiss', '×']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = buttonStyle;
    button.addEventListener('click', () => {
      prompt.remove();
      emit(action === 'next' ? 'next-requested' : 'next-dismissed', {});
    });
    prompt.append(button);
  }
  (document.fullscreenElement ?? document.body).append(prompt);
}

function handleCommand(message) {
  if (message.command === 'seek') seekVideo(Number(message.seconds) || 0);
  if (message.command === 'next-prompt') showNextPrompt(message.label);
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
    if (message.type === 'ONEPACE_PLAYER_COMMAND') {
      handleCommand(message);
      return;
    }
    if (message.type !== 'ONEPACE_PLAYER_PREFERENCES') return;
    currentPreferences = message.payload;
    bindPlayer();
    applyPreferences(getVideo());
    applyGoogleDrivePreferences();
  });
}
