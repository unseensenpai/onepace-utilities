export function shouldCenterActiveEpisode(reason) {
  return reason === 'initialize' || reason === 'episode-navigation';
}
