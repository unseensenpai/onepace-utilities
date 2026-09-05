import test from 'node:test';
import assert from 'node:assert/strict';

import { buildArcMaster } from '../src/shared/arc-master.js';

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
