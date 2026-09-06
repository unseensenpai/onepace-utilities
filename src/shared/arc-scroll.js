export function shouldCenterActiveEpisode(reason) {
  return reason === 'initialize' || reason === 'episode-navigation';
}

export function resolveArcScrollTop({ saved, currentEpisodeNumber, activeCardCenter }) {
  if (saved?.episodeNumber === currentEpisodeNumber && Number.isFinite(saved.scrollTop)) {
    return saved.scrollTop;
  }
  return activeCardCenter;
}
