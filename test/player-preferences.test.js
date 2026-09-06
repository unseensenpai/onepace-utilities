import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveStartPosition,
  shouldApplyPlayerPreferences
} from '../src/shared/player-preferences.js';

test('does not reapply player preferences after a progress-only panel render', () => {
  assert.equal(shouldApplyPlayerPreferences('progress-update'), false);
});

test('applies player preferences only on initial load or a player setting change', () => {
  assert.equal(shouldApplyPlayerPreferences('initialize'), true);
  assert.equal(shouldApplyPlayerPreferences('player-setting-change'), true);
});

test('never starts before the configured episode start while preserving later progress', () => {
  assert.equal(resolveStartPosition({ savedPosition: 10, minimumStart: 117, resumeEnabled: true }), 117);
  assert.equal(resolveStartPosition({ savedPosition: 480, minimumStart: 117, resumeEnabled: true }), 480);
  assert.equal(resolveStartPosition({ savedPosition: 480, minimumStart: 117, resumeEnabled: false }), 117);
});
