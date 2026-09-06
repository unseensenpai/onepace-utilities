import test from 'node:test';
import assert from 'node:assert/strict';

import { formatEpisodeContext } from '../src/shared/episode-context.js';

test('formats the active arc, episode number, and title for the player heading', () => {
  assert.equal(
    formatEpisodeContext({ arcName: 'Water Seven', episodeNumber: 123, episodeName: 'Söylentiler' }),
    'Water Seven · 123. Bölüm: Söylentiler'
  );
});

test('keeps the episode title as the card subtitle while progress is saved', () => {
  assert.equal(
    formatEpisodeContext({ arcName: '', episodeNumber: 123, episodeName: 'Söylentiler' }),
    '123. Bölüm: Söylentiler'
  );
});
