import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldFinishPlayback } from '../src/shared/player-end.js';

test('treats a provider stall in the final five seconds as playback completion', () => {
  assert.equal(shouldFinishPlayback({ eventType: 'waiting', currentTime: 1842, duration: 1845 }), true);
  assert.equal(shouldFinishPlayback({ eventType: 'stalled', currentTime: 1840, duration: 1845 }), true);
});

test('does not treat ordinary buffering away from the end as completion', () => {
  assert.equal(shouldFinishPlayback({ eventType: 'waiting', currentTime: 600, duration: 1845 }), false);
  assert.equal(shouldFinishPlayback({ eventType: 'stalled', currentTime: 1839, duration: 1845 }), false);
});

test('always accepts the native ended event', () => {
  assert.equal(shouldFinishPlayback({ eventType: 'ended', currentTime: 1845, duration: 1845 }), true);
});
