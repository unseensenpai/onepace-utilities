// Runs in the player page's own world, where JW Player's jwplayer() API lives; player-frame.js runs
// in the isolated world and asks for playback through a DOM event.
document.addEventListener('onepace-utilities:jw-play', () => {
  const player = typeof window.jwplayer === 'function' ? window.jwplayer() : null;
  if (typeof player?.play !== 'function' || player.getState?.() === 'playing') return;
  player.play();
});
