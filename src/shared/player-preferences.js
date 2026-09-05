export function shouldApplyPlayerPreferences(reason) {
  return reason === 'initialize' || reason === 'player-setting-change';
}
