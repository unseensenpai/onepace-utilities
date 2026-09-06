export function shouldCenterActiveEpisode(reason) {
  return reason === 'initialize' || reason === 'episode-navigation';
}

export function resolveArcScrollTop({ saved, currentEpisodeNumber, activeCardCenter, activeArcTop }) {
  if (saved?.episodeNumber === currentEpisodeNumber && Number.isFinite(saved.scrollTop)) {
    return saved.scrollTop;
  }
  return activeArcTop ?? activeCardCenter;
}

export function resolveArcFocusTop({ activeArcOffsetTop, scrollerOffsetTop }) {
  return Math.max(0, activeArcOffsetTop - scrollerOffsetTop);
}
