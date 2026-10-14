import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release package includes every top-level path required by the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const zipCommand = workflow.match(/run:\s+zip\s+-r\s+\S+\s+([^\r\n]+)/)?.[1] ?? '';
  const packagedPaths = new Set(zipCommand.split(/\s+/));
  const iconPaths = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {})
  ];
  const requiredTopLevelPaths = new Set(iconPaths.map((path) => path.split('/')[0]));

  for (const requiredPath of requiredTopLevelPaths) {
    assert.ok(packagedPaths.has(requiredPath), `release package is missing ${requiredPath}`);
  }
});

test('loads the backup API before the OnePace page content script', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const pageScripts = manifest.content_scripts.find((entry) =>
    entry.matches.includes('https://www.onepacetr.net/*')
  ).js;

  assert.deepEqual(pageScripts, ['src/shared/backup.js', 'src/content/content.js']);
});

test('loads the AnimPow core before its page content script on every AnimPow page', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const entry = manifest.content_scripts.find((item) => item.matches.includes('https://animpow.com/*'));

  assert.ok(entry, 'AnimPow content script entry is missing');
  assert.deepEqual(entry.js, ['src/shared/animpow-core.js', 'src/content/animpow.js']);
  assert.deepEqual(entry.css, ['src/content/animpow.css']);
});

test('loads the shared arc data and TRanimeizle core before its page content script', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const entry = manifest.content_scripts.find((item) => item.matches.includes('https://www.tranimeizle.live/*'));

  assert.ok(entry, 'TRanimeizle content script entry is missing');
  assert.deepEqual(entry.js, ['src/shared/animpow-core.js', 'src/shared/tranime-core.js', 'src/content/tranime.js']);
  assert.deepEqual(entry.css, ['src/content/animpow.css', 'src/content/tranime.css']);
});
