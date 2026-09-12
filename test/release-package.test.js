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
