import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveArcScrollTop,
  shouldCenterActiveEpisode
} from '../src/shared/arc-scroll.js';

test('does not center the active card when progress refreshes the panel', () => {
  assert.equal(shouldCenterActiveEpisode('progress-update'), false);
});

test('centers the active card for an initial load or episode navigation', () => {
  assert.equal(shouldCenterActiveEpisode('initialize'), true);
  assert.equal(shouldCenterActiveEpisode('episode-navigation'), true);
});

test('restores the persisted panel scroll after refresh for the same episode', () => {
  assert.equal(resolveArcScrollTop({
    saved: { episodeNumber: 118, scrollTop: 642 },
    currentEpisodeNumber: 118,
    activeCardCenter: 300
  }), 642);
});

test('uses the active card position when navigating to another episode', () => {
  assert.equal(resolveArcScrollTop({
    saved: { episodeNumber: 117, scrollTop: 642 },
    currentEpisodeNumber: 118,
    activeCardCenter: 300
  }), 300);
});
