import test from 'node:test';
import assert from 'node:assert/strict';

import { hasExtensionRuntime } from '../src/shared/runtime.js';

test('returns false when a reloaded extension has no runtime messaging API', () => {
  assert.equal(hasExtensionRuntime({}), false);
  assert.equal(hasExtensionRuntime({ runtime: {} }), false);
});

test('returns true when runtime messaging is available', () => {
  assert.equal(hasExtensionRuntime({ runtime: { sendMessage() {} } }), true);
});
