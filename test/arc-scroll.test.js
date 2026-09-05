import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldCenterActiveEpisode } from '../src/shared/arc-scroll.js';

test('does not center the active card when progress refreshes the panel', () => {
  assert.equal(shouldCenterActiveEpisode('progress-update'), false);
});

test('centers the active card for an initial load or episode navigation', () => {
  assert.equal(shouldCenterActiveEpisode('initialize'), true);
  assert.equal(shouldCenterActiveEpisode('episode-navigation'), true);
});
