export function shouldFinishPlayback({ eventType, currentTime, duration }) {
  if (eventType === 'ended') return true;
  if (eventType !== 'waiting' && eventType !== 'stalled') return false;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const remaining = duration - currentTime;
  return remaining >= 0 && remaining <= 5;
}
