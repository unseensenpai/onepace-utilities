import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadBackupApi() {
  try {
    const source = await readFile(new URL('../src/shared/backup.js', import.meta.url), 'utf8');
    const context = {};
    vm.runInNewContext(source, context);
    return context.OnePaceBackup ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function getBackupApi() {
  const api = await loadBackupApi();
  assert.ok(api, 'backup API must be available to the content script');
  return api;
}

test('creates and parses a versioned progress and settings backup', async () => {
  const api = await getBackupApi();
  const backup = api.createBackup({
    progress: [{ episodeNumber: 188, state: 'in-progress', positionSeconds: 600, durationSeconds: 1200, updatedAt: '2026-09-12T12:00:00.000Z' }],
    settings: { playbackRate: 2 },
    exportedAt: '2026-09-12T13:00:00.000Z'
  });

  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.exportedAt, '2026-09-12T13:00:00.000Z');
  assert.equal(api.parseBackup(JSON.stringify(backup)).progress[0].episodeNumber, 188);
  assert.throws(() => api.parseBackup('{"schemaVersion":99,"progress":[],"settings":{}}'));
});

test('merges unique episodes and keeps completed progress from regressing', async () => {
  const api = await getBackupApi();
  const result = api.mergeProgressRecords([
    { episodeNumber: 188, state: 'completed', positionSeconds: 1200, durationSeconds: 1200, updatedAt: '2026-09-10T12:00:00.000Z' },
    { episodeNumber: 190, state: 'in-progress', positionSeconds: 300, durationSeconds: 1000, updatedAt: '2026-09-12T12:00:00.000Z' }
  ], [
    { episodeNumber: 188, state: 'in-progress', positionSeconds: 900, durationSeconds: 1200, updatedAt: '2026-09-12T13:00:00.000Z' },
    { episodeNumber: 189, state: 'in-progress', positionSeconds: 200, durationSeconds: 900, updatedAt: '2026-09-11T12:00:00.000Z' }
  ]);

  assert.equal(result.records.length, 3);
  assert.equal(result.records.find((record) => record.episodeNumber === 188).state, 'completed');
  assert.equal(result.records.find((record) => record.episodeNumber === 189).positionSeconds, 200);
  assert.equal(result.summary.added, 1);
  assert.equal(result.summary.keptCompleted, 1);
});

test('uses the newest in-progress record and falls back to the furthest position for invalid dates', async () => {
  const api = await getBackupApi();
  const result = api.mergeProgressRecords([
    { episodeNumber: 188, state: 'in-progress', positionSeconds: 700, durationSeconds: 1200, updatedAt: '2026-09-12T14:00:00.000Z' },
    { episodeNumber: 189, state: 'in-progress', positionSeconds: 200, durationSeconds: 900, updatedAt: '' }
  ], [
    { episodeNumber: 188, state: 'in-progress', positionSeconds: 900, durationSeconds: 1200, updatedAt: '2026-09-12T13:00:00.000Z' },
    { episodeNumber: 189, state: 'in-progress', positionSeconds: 500, durationSeconds: 900, updatedAt: 'invalid' },
    { episodeNumber: 0, state: 'completed', positionSeconds: 1, durationSeconds: 1, updatedAt: '2026-09-12T13:00:00.000Z' }
  ]);

  assert.equal(result.records.find((record) => record.episodeNumber === 188).positionSeconds, 700);
  assert.equal(result.records.find((record) => record.episodeNumber === 189).positionSeconds, 500);
  assert.equal(result.records.some((record) => record.episodeNumber === 0), false);
  assert.equal(result.summary.invalid, 1);
});

test('accepts only valid known settings from an imported backup', async () => {
  const api = await getBackupApi();
  assert.equal(typeof api.sanitizeSettings, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(api.sanitizeSettings({
    autoAdvance: false,
    playbackRate: 2,
    customStartSeconds: -20,
    useResume: 'yes',
    language: 'xx',
    arcMasterOpen: true,
    unexpected: 'value'
  }))), {
    autoAdvance: false,
    playbackRate: 2,
    arcMasterOpen: true
  });
});

test('skips malformed numeric progress instead of allowing it to override valid local data', async () => {
  const api = await getBackupApi();
  const local = { episodeNumber: 188, state: 'in-progress', positionSeconds: 600, durationSeconds: 1200, updatedAt: '2026-09-12T12:00:00.000Z' };
  const result = api.mergeProgressRecords([local], [
    { episodeNumber: 188, state: 'completed', positionSeconds: '1200', durationSeconds: Infinity, updatedAt: '2026-09-12T13:00:00.000Z' },
    { episodeNumber: '189', state: 'in-progress', positionSeconds: 10, durationSeconds: 900, updatedAt: '2026-09-12T13:00:00.000Z' }
  ]);

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].state, 'in-progress');
  assert.equal(result.summary.invalid, 2);
});

test('falls back to position when an imported progress timestamp is not a string', async () => {
  const api = await getBackupApi();
  const local = { episodeNumber: 188, state: 'in-progress', positionSeconds: 120, durationSeconds: 1200, updatedAt: '2026-09-10T10:00:00.000Z' };
  const imported = { episodeNumber: 188, state: 'in-progress', positionSeconds: 240, durationSeconds: 1200, updatedAt: 0 };

  const result = api.mergeProgressRecords([local], [imported]);

  assert.equal(result.records[0].positionSeconds, 240);
  assert.equal(result.records[0].updatedAt, '');
});
