import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldApplyPlayerPreferences } from '../src/shared/player-preferences.js';

test('does not reapply player preferences after a progress-only panel render', () => {
  assert.equal(shouldApplyPlayerPreferences('progress-update'), false);
});

test('applies player preferences only on initial load or a player setting change', () => {
  assert.equal(shouldApplyPlayerPreferences('initialize'), true);
  assert.equal(shouldApplyPlayerPreferences('player-setting-change'), true);
});
