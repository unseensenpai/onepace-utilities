import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('places the source dock in the Arc Master flow instead of over the player', async () => {
  const stylesheet = await readFile(new URL('../src/content/styles.css', import.meta.url), 'utf8');
  const sourceDockRule = stylesheet.match(/\.players\.opu-source-dock\{([^}]*)\}/)?.[1] ?? '';

  assert.match(sourceDockRule, /position:static!important/);
  assert.match(sourceDockRule, /justify-content:center/);
});

test('styles source links as Arc Master buttons and highlights the selected source', async () => {
  const stylesheet = await readFile(new URL('../src/content/styles.css', import.meta.url), 'utf8');
  const sourceLinkRule = stylesheet.match(/\.players\.opu-source-dock \.player a\{([^}]*)\}/)?.[1] ?? '';
  const selectedSourceRule = stylesheet.match(/\.players\.opu-source-dock \.player a\.selected\{([^}]*)\}/)?.[1] ?? '';

  assert.match(sourceLinkRule, /background:#303744/);
  assert.match(sourceLinkRule, /color:#edf3f7/);
  assert.match(selectedSourceRule, /background:#318dca/);
  assert.match(selectedSourceRule, /color:#fff/);
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

test('keeps the open arc heading visible while its episode grid scrolls', async () => {
  const stylesheet = await readFile(new URL('../src/content/styles.css', import.meta.url), 'utf8');
  const headingRule = stylesheet.match(/\.opu-arc\[open\]>summary\{([^}]*)\}/)?.[1] ?? '';

  assert.match(headingRule, /position:sticky/);
  assert.match(headingRule, /top:0/);
  assert.match(headingRule, /z-index:/);
});

test('keeps all active arc actions below the sticky arc heading', async () => {
  const stylesheet = await readFile(new URL('../src/content/styles.css', import.meta.url), 'utf8');
  const actionsRule = stylesheet.match(/\.opu-arc-active\[open\]>\.opu-arc-actions\{([^}]*)\}/)?.[1] ?? '';

  assert.match(actionsRule, /position:sticky/);
  assert.match(actionsRule, /top:var\(--opu-arc-summary-height/);
  assert.match(actionsRule, /z-index:/);
});
