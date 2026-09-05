let currentPreferences = null;

function getVideo() {
  return document.querySelector('video');
}

function emit(event, detail) {
  if (typeof chrome?.runtime?.sendMessage !== 'function') return;
  chrome.runtime.sendMessage({ type: 'ONEPACE_PLAYER_EVENT', event, detail });
}

function applyPreferences(video) {
  if (!video || !currentPreferences) return;
  video.playbackRate = Number(currentPreferences.playbackRate) || 1;
  const startAt = Number(currentPreferences.startAtSeconds) || 0;
  if (startAt > 0 && Number.isFinite(video.duration) && startAt < video.duration - 1) {
    video.currentTime = startAt;
  }
}

function bindVideo(video) {
  if (!video || video.dataset.onepaceUtilitiesBound) return;
  video.dataset.onepaceUtilitiesBound = 'true';
  video.addEventListener('loadedmetadata', () => applyPreferences(video));
  video.addEventListener('timeupdate', () => emit('position', {
    positionSeconds: Math.floor(video.currentTime),
    durationSeconds: Math.floor(video.duration || 0)
  }));
  video.addEventListener('ended', () => emit('ended', {
    durationSeconds: Math.floor(video.duration || 0)
  }));
  applyPreferences(video);
}

new MutationObserver(() => bindVideo(getVideo())).observe(document.documentElement, {
  childList: true,
  subtree: true
});
bindVideo(getVideo());

if (typeof chrome?.runtime?.onMessage?.addListener === 'function') {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'ONEPACE_PLAYER_PREFERENCES') return;
    currentPreferences = message.payload;
    bindVideo(getVideo());
    applyPreferences(getVideo());
  });
}
