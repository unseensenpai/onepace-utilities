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

test('keeps the embedded player at a 16:9 aspect ratio', async () => {
  const stylesheet = await readFile(new URL('../src/content/styles.css', import.meta.url), 'utf8');
  const playerRule = stylesheet.match(/\.active-player iframe\{([^}]*)\}/)?.[1] ?? '';

  assert.match(playerRule, /aspect-ratio:16\/9/);
  assert.match(playerRule, /height:auto!important/);
});

test('uses a proportional width for the Arc Master panel', async () => {
  const stylesheet = await readFile(new URL('../src/content/styles.css', import.meta.url), 'utf8');
  const panelRule = stylesheet.match(/\.episode-detail \.row>\.col-lg-4\{([^}]*)\}/)?.[1] ?? '';

  assert.match(panelRule, /flex:0 0 22%!important/);
  assert.match(panelRule, /max-width:22%!important/);
});
