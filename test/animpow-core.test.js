import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function getCore() {
  const source = await readFile(new URL('../src/shared/animpow-core.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.ok(context.AnimPowCore, 'AnimPowCore must be exposed on globalThis');
  return context.AnimPowCore;
}

const ONE_PIECE = '9072-18D4E79F4FC3';

// Values created inside the vm context have that realm's prototypes; compare as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('parses watch paths and builds them back', async () => {
  const core = await getCore();
  assert.deepEqual(
    plain(core.parseWatchPath(`/watch/${ONE_PIECE}/s1e1035`)),
    { coreId: ONE_PIECE, season: 1, episode: 1035 }
  );
  assert.equal(core.parseWatchPath('/catalog'), null);
  assert.equal(core.episodePath(ONE_PIECE, 1, 1036), `/watch/${ONE_PIECE}/s1e1036`);
});

test('groups One Piece into the wiki story arcs, gap-free', async () => {
  const core = await getCore();
  const arcs = core.groupEpisodes({ coreId: ONE_PIECE, maxEpisode: 1180 });
  const byName = Object.fromEntries(arcs.map((arc) => [arc.name, arc]));
  assert.deepEqual(plain([arcs[0].name, arcs[0].from, arcs[0].to, arcs[0].saga]), ['Romance Dawn', 1, 3, 'East Blue']);
  assert.deepEqual(plain([byName['Wano Country'].from, byName['Wano Country'].to]), [890, 1085]);
  assert.deepEqual(plain([byName.Egghead.from, byName.Egghead.to, byName.Egghead.saga]), [1086, 1155, 'Final']);
  assert.equal(byName.Elbaph.to, 1180);
  assert.equal(byName['Warship Island'].filler, true);
  assert.equal(byName['Wano Country'].filler, false);
  const all = arcs.flatMap((arc) => [...arc.episodes]);
  assert.equal(all.length, 1180);
  assert.equal(new Set(all).size, 1180);
  assert.equal(all.every((number, index) => number === index + 1), true);
});

test('stops One Piece arcs at the newest known episode', async () => {
  const core = await getCore();
  const arcs = core.groupEpisodes({ coreId: ONE_PIECE, maxEpisode: 1040 });
  assert.equal(arcs.at(-1).name, 'Wano Country');
  assert.equal(arcs.at(-1).to, 1040);
});

test('groups other shows into 100-episode blocks only', async () => {
  const core = await getCore();
  const arcs = core.groupEpisodes({ coreId: 'other', maxEpisode: 230 });
  assert.deepEqual(plain(arcs.map((arc) => [arc.from, arc.to, arc.name])), [[1, 100, null], [101, 200, null], [201, 230, null]]);
});

test('tags One Piece episodes by filler type', async () => {
  const core = await getCore();
  assert.equal(core.episodeType(ONE_PIECE, 1035), 'canon');
  assert.equal(core.episodeType(ONE_PIECE, 1029), 'filler');
  assert.equal(core.episodeType(ONE_PIECE, 1084), 'anime-canon');
  assert.equal(core.episodeType(ONE_PIECE, 988), 'mixed');
  assert.equal(core.episodeType('other', 1029), null);
});

test('saves progress, keeps completed episodes completed and separates shows', async () => {
  const core = await getCore();
  let records = core.upsertProgress([], {
    coreId: ONE_PIECE, episodeNumber: 1035, positionSeconds: 300, durationSeconds: 1430, updatedAt: '2026-10-14T10:00:00.000Z'
  });
  assert.equal(records[0].episodeKey, `${ONE_PIECE}:1035`);
  assert.equal(records[0].state, 'in-progress');

  records = core.upsertProgress(records, {
    coreId: ONE_PIECE, episodeNumber: 1035, positionSeconds: 1430, durationSeconds: 1430, completed: true, updatedAt: '2026-10-14T10:20:00.000Z'
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'completed');

  records = core.upsertProgress(records, {
    coreId: ONE_PIECE, episodeNumber: 1035, positionSeconds: 10, durationSeconds: 1430, updatedAt: '2026-10-14T11:00:00.000Z'
  });
  assert.equal(records[0].state, 'completed');

  records = core.upsertProgress(records, {
    coreId: 'other', episodeNumber: 1035, positionSeconds: 10, durationSeconds: 1430, updatedAt: '2026-10-14T11:00:00.000Z'
  });
  assert.equal(records.length, 2);
  assert.equal(core.findRecord(records, 'other', 1035).positionSeconds, 10);
});

test('marks a list of episodes completed in one go', async () => {
  const core = await getCore();
  const records = core.markCompleted([], ONE_PIECE, [1035, 1036], '2026-10-14T10:00:00.000Z');
  assert.deepEqual(plain(records.map((record) => [record.episodeNumber, record.state])), [[1035, 'completed'], [1036, 'completed']]);
});

test('resolves the start position from resume and the minimum start', async () => {
  const core = await getCore();
  const record = { state: 'in-progress', positionSeconds: 600 };
  assert.equal(core.resolveStartPosition({ record, customStartSeconds: 150, useResume: true }), 600);
  assert.equal(core.resolveStartPosition({ record, customStartSeconds: 150, useResume: false }), 150);
  assert.equal(core.resolveStartPosition({ record: null, customStartSeconds: 150, useResume: true }), 150);
  assert.equal(core.resolveStartPosition({ record: { state: 'completed', positionSeconds: 1400 }, customStartSeconds: 0, useResume: true }), 0);
});

test('only treats episode-length videos as the episode, not ad clips', async () => {
  const core = await getCore();
  assert.equal(core.isEpisodeVideo(30), false);
  assert.equal(core.isEpisodeVideo(1430), true);
  assert.equal(core.isEpisodeVideo(NaN), false);
});

test('detects playback completion near the end', async () => {
  const core = await getCore();
  assert.equal(core.shouldFinishPlayback({ eventType: 'ended', currentTime: 0, duration: 1430 }), true);
  assert.equal(core.shouldFinishPlayback({ eventType: 'waiting', currentTime: 1427, duration: 1430 }), true);
  assert.equal(core.shouldFinishPlayback({ eventType: 'waiting', currentTime: 600, duration: 1430 }), false);
});

test('offers the next episode only in the last 30 seconds', async () => {
  const core = await getCore();
  assert.equal(core.isNearEnd({ currentTime: 1401, duration: 1430 }), true);
  assert.equal(core.isNearEnd({ currentTime: 1399, duration: 1430 }), false);
  assert.equal(core.isNearEnd({ currentTime: 1430, duration: 1430 }), false);
  assert.equal(core.isNearEnd({ currentTime: 10, duration: NaN }), false);
});
