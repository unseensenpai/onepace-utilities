import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProgressRecord,
  getLatestIncomplete,
  upsertProgressRecord
} from '../src/shared/progress.js';

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
