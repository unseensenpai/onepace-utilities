let currentPreferences = null;
let completionSent = false;

function getVideo() {
  return document.querySelector('video');
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

new MutationObserver(() => bindVideo(getVideo())).observe(document.documentElement, {
  childList: true,
  subtree: true
});
bindVideo(getVideo());
sendRuntimeMessage({ type: 'ONEPACE_PLAYER_READY' });

if (typeof chrome?.runtime?.onMessage?.addListener === 'function') {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'ONEPACE_PLAYER_PREFERENCES') return;
    currentPreferences = message.payload;
    bindVideo(getVideo());
    applyPreferences(getVideo());
  });
}
