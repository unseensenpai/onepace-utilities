import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArcMaster,
  getArcProgressState,
  getNextEpisode
} from '../src/shared/arc-master.js';

test('groups OnePaceTR episodes by season and sorts their cards by number', () => {
  const arcs = buildArcMaster([
    {
      id: 2,
      number: 2,
      name: 'Iceburg-san',
      duration: '30:48',
      manga: '324-326',
      anime: '229-231',
      season: { number: 1, name: 'Water Seven', slug: 'water-seven', total: 20 }
    },
    {
      id: 1,
      number: 1,
      name: 'Su Şehri',
      duration: '28:33',
      manga: '322-323',
      anime: '228',
      season: { number: 1, name: 'Water Seven', slug: 'water-seven', total: 20 }
    }
  ]);

  assert.deepEqual(arcs, [
    {
      key: 'water-seven',
      name: 'Water Seven',
      plannedEpisodes: 20,
      episodes: [
        { key: 'water-seven-1', number: 1, name: 'Su Şehri', duration: '28:33', manga: '322-323', anime: '228' },
        { key: 'water-seven-2', number: 2, name: 'Iceburg-san', duration: '30:48', manga: '324-326', anime: '229-231' }
      ]
    }
  ]);
});

test('classifies an arc as completed, active, or untouched from its progress counts', () => {
  assert.equal(getArcProgressState({ completed: 8, total: 8, isCurrent: false }), 'completed');
  assert.equal(getArcProgressState({ completed: 0, total: 20, isCurrent: true }), 'active');
  assert.equal(getArcProgressState({ completed: 0, total: 20, isCurrent: false }), 'untouched');
});

test('returns the first episode of the next arc after the current arc ends', () => {
  const arcs = [
    { episodes: [{ number: 117 }] },
    { episodes: [{ number: 118 }, { number: 119 }] }
  ];

  assert.deepEqual(getNextEpisode(arcs, 117), { number: 118 });
  assert.equal(getNextEpisode(arcs, 119), null);
});
