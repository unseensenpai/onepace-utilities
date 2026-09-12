import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveArcFocusTop,
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

test('uses the active arc heading when navigating to another episode', () => {
  assert.equal(resolveArcScrollTop({
    saved: { episodeNumber: 117, scrollTop: 642 },
    currentEpisodeNumber: 118,
    activeCardCenter: 300,
    activeArcTop: 220
  }), 220);
});

test('places the active episode row immediately below the sticky arc heading', () => {
  assert.equal(resolveArcFocusTop({
    currentScrollTop: 480,
    activeCardTop: 220,
    scrollerTop: 80,
    stickyHeaderHeight: 34,
    stickyActionsHeight: 96,
    gap: 8
  }), 482);
});
