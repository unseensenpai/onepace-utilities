import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('centers the player source dock so it does not cover fullscreen controls', async () => {
  const stylesheet = await readFile(new URL('../src/content/styles.css', import.meta.url), 'utf8');
  const sourceDockRule = stylesheet.match(/\.players\.opu-source-dock\{([^}]*)\}/)?.[1] ?? '';

  assert.match(sourceDockRule, /left:50%/);
  assert.match(sourceDockRule, /right:auto/);
  assert.match(sourceDockRule, /transform:translateX\(-50%\)/);
});
