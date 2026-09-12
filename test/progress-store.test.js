import test from 'node:test';
import assert from 'node:assert/strict';

import * as progressApi from '../src/shared/progress.js';

const {
  createProgressRecord,
  getLatestIncomplete,
  markEpisodesCompleted,
  upsertProgressRecord
} = progressApi;

test('creates an in-progress record with the latest saved episode position', () => {
  const record = createProgressRecord({
    episodeKey: 'water-seven-117',
    episodeNumber: 117,
    positionSeconds: 1122,
    durationSeconds: 1848,
    updatedAt: '2026-09-05T18:00:00.000Z'
  });

  assert.deepEqual(record, {
    episodeKey: 'water-seven-117',
    episodeNumber: 117,
    state: 'in-progress',
    positionSeconds: 1122,
    durationSeconds: 1848,
    updatedAt: '2026-09-05T18:00:00.000Z'
  });
});

test('marks every episode in the selected arc complete without changing other arcs', () => {
  const updated = markEpisodesCompleted([
    { episodeKey: 'water-seven-116', episodeNumber: 116, state: 'in-progress', positionSeconds: 12, durationSeconds: 100, updatedAt: 'old' },
    { episodeKey: 'alabasta-1', episodeNumber: 1, state: 'in-progress', positionSeconds: 10, durationSeconds: 80, updatedAt: 'old' }
  ], [
    { number: 116 },
    { number: 117, durationSeconds: 120 }
  ], '2026-09-05T20:00:00.000Z');

  assert.equal(updated.find((record) => record.episodeNumber === 116).state, 'completed');
  assert.equal(updated.find((record) => record.episodeNumber === 117).positionSeconds, 120);
  assert.equal(updated.find((record) => record.episodeNumber === 1).state, 'in-progress');
});

test('updates only the watched episode and returns the latest incomplete record', () => {
  const records = [
    {
      episodeKey: 'water-seven-116',
      episodeNumber: 116,
      state: 'completed',
      positionSeconds: 1713,
      durationSeconds: 1713,
      updatedAt: '2026-09-05T16:00:00.000Z'
    },
    {
      episodeKey: 'water-seven-117',
      episodeNumber: 117,
      state: 'in-progress',
      positionSeconds: 300,
      durationSeconds: 1848,
      updatedAt: '2026-09-05T17:00:00.000Z'
    }
  ];

  const updated = upsertProgressRecord(records, {
    episodeKey: 'water-seven-117',
    episodeNumber: 117,
    positionSeconds: 1122,
    durationSeconds: 1848,
    updatedAt: '2026-09-05T18:00:00.000Z'
  });

  assert.equal(updated[0].positionSeconds, 1713);
  assert.equal(updated[1].positionSeconds, 1122);
  assert.deepEqual(getLatestIncomplete(updated), updated[1]);
});

test('keeps a manually completed episode completed when later position events arrive', () => {
  const completed = {
    episodeKey: 'water-seven-117',
    episodeNumber: 117,
    state: 'completed',
    positionSeconds: 1848,
    durationSeconds: 1848,
    updatedAt: '2026-09-05T18:00:00.000Z'
  };

  const updated = upsertProgressRecord([completed], {
    episodeKey: 'water-seven-117',
    episodeNumber: 117,
    positionSeconds: 600,
    durationSeconds: 1848,
    updatedAt: '2026-09-05T18:01:00.000Z'
  });

  assert.deepEqual(updated, [completed]);
});

test('marks every episode through the current episode watched without changing later episodes', () => {
  assert.equal(typeof progressApi.markEpisodesThroughCompleted, 'function');
  const arcs = [
    { episodes: [{ number: 1 }, { number: 2 }] },
    { episodes: [{ number: 3 }, { number: 4 }] }
  ];
  const updated = progressApi.markEpisodesThroughCompleted([
    { episodeNumber: 4, episodeKey: 'episode-4', state: 'in-progress', positionSeconds: 20, durationSeconds: 100, updatedAt: 'old' }
  ], arcs, 3, '2026-09-12T14:00:00.000Z');

  assert.deepEqual(updated.filter((record) => record.state === 'completed').map((record) => record.episodeNumber).sort(), [1, 2, 3]);
  assert.equal(updated.find((record) => record.episodeNumber === 4).state, 'in-progress');
});
