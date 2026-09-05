import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { hasExtensionRuntime } from '../src/shared/runtime.js';

test('returns false when a reloaded extension has no runtime messaging API', () => {
  assert.equal(hasExtensionRuntime({}), false);
  assert.equal(hasExtensionRuntime({ runtime: {} }), false);
});

test('returns true when runtime messaging is available', () => {
  assert.equal(hasExtensionRuntime({ runtime: { sendMessage() {} } }), true);
});

test('guards iframe event delivery when a reloaded extension invalidates runtime messaging', async () => {
  const playerFrame = await readFile(new URL('../src/content/player-frame.js', import.meta.url), 'utf8');
  assert.match(playerFrame, /typeof chrome\?\.runtime\?\.sendMessage !== 'function'/);
});
