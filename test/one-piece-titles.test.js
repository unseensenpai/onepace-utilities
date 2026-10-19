import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function getTitles() {
  const source = await readFile(new URL('../src/shared/one-piece-titles.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.ok(context.OnePieceTitles, 'OnePieceTitles must be exposed on globalThis');
  return context.OnePieceTitles;
}

test('has an English title for every bundled episode', async () => {
  const titles = await getTitles();
  assert.ok(titles.lastEpisode >= 1100);
  for (let episode = 1; episode <= titles.lastEpisode; episode += 1) {
    assert.ok(titles.episodeTitle(episode, 'en'), `episode ${episode} has no English title`);
  }
});

test('keeps titles on their episode numbers, past specials and recap series', async () => {
  const titles = await getTitles();
  assert.match(titles.episodeTitle(1, 'en'), /King of the Pirates/);
  assert.match(titles.episodeTitle(517, 'en'), /New Chapter/);
  assert.match(titles.episodeTitle(1092, 'en'), /Bonney/);
  assert.match(titles.episodeTitle(1055, 'es'), /Onigashima/);
});

test('falls back to English and picks the browser language when bundled', async () => {
  const titles = await getTitles();
  assert.equal(titles.episodeTitle(1, 'xx'), titles.episodeTitle(1, 'en'));
  assert.equal(titles.episodeTitle(99999, 'en'), '');
  assert.equal(titles.preferredLanguage('tr-TR'), 'tr');
  assert.equal(titles.preferredLanguage('es-419'), 'es');
  assert.equal(titles.preferredLanguage('de-DE'), 'en');
  assert.equal(titles.preferredLanguage(undefined), 'en');
});
