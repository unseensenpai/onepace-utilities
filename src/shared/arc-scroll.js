export function shouldCenterActiveEpisode(reason) {
  return reason === 'initialize' || reason === 'episode-navigation';
}

export function resolveArcScrollTop({ saved, currentEpisodeNumber, activeCardCenter, activeArcTop }) {
  if (saved?.episodeNumber === currentEpisodeNumber && Number.isFinite(saved.scrollTop)) {
    return saved.scrollTop;
  }
  return activeArcTop ?? activeCardCenter;
}

export function resolveArcFocusTop({
  currentScrollTop,
  activeCardTop,
  scrollerTop,
  stickyHeaderHeight,
  stickyActionsHeight = 0,
  gap = 0
}) {
  return Math.max(
    0,
    currentScrollTop + activeCardTop - scrollerTop - stickyHeaderHeight - stickyActionsHeight - gap
  );
}
