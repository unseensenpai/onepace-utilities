import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function getCore() {
  const source = await readFile(new URL('../src/shared/tranime-core.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.ok(context.TranimeCore, 'TranimeCore must be exposed on globalThis');
  return context.TranimeCore;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('parses episode paths, including suffixed ones', async () => {
  const core = await getCore();
  assert.deepEqual(plain(core.parseEpisodePath('/one-piece-1037-bolum-izle')), { slug: 'one-piece', episode: 1037 });
  assert.deepEqual(plain(core.parseEpisodePath('/one-piece-1-bolum-izle-hd')), { slug: 'one-piece', episode: 1 });
  assert.deepEqual(plain(core.parseEpisodePath('/boruto-naruto-next-generations-12-bolum-izle')), {
    slug: 'boruto-naruto-next-generations',
    episode: 12
  });
  assert.equal(core.parseEpisodePath('/anime/one-piece-izle'), null);
  assert.equal(core.parseEpisodePath('/'), null);
});

test('maps the site episode list to links and falls back to the usual path', async () => {
  const core = await getCore();
  const links = core.collectEpisodeLinks('one-piece', [
    '/one-piece-1-bolum-izle-hd',
    '/one-piece-2-bolum-izle',
    '/naruto-2-bolum-izle',
    '/anime/one-piece-izle'
  ]);
  assert.deepEqual(plain(links), { 1: '/one-piece-1-bolum-izle-hd', 2: '/one-piece-2-bolum-izle' });
  assert.equal(core.episodeLink(links, 'one-piece', 1), '/one-piece-1-bolum-izle-hd');
  assert.equal(core.episodeLink(links, 'one-piece', 1038), '/one-piece-1038-bolum-izle');
});
