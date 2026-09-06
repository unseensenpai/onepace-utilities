export function shouldApplyPlayerPreferences(reason) {
  return reason === 'initialize' || reason === 'player-setting-change';
}

export function resolveStartPosition({ savedPosition, minimumStart, resumeEnabled }) {
  const floor = Math.max(0, Number(minimumStart) || 0);
  if (!resumeEnabled) return floor;
  return Math.max(floor, Math.max(0, Number(savedPosition) || 0));
}
