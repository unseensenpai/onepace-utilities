(function initializeAnimPowCore(globalObject) {
  const ONE_PIECE_CORE_ID = '9072-18D4E79F4FC3';
  const BLOCK_SIZE = 100;
  const MIN_EPISODE_SECONDS = 600;

  // onepiece.fandom.com/wiki/Story_Arcs: [first anime episode, arc, saga]. Each arc runs to the
  // next arc's start; anime-only arcs inside a canon arc's span stay in that arc (their episodes are
  // tagged as filler), the ones between canon arcs are listed with saga null.
  const ONE_PIECE_ARCS = [
    [1, 'Romance Dawn', 'East Blue'], [4, 'Orange Town', 'East Blue'], [9, 'Syrup Village', 'East Blue'],
    [19, 'Baratie', 'East Blue'], [31, 'Arlong Park', 'East Blue'], [45, 'Loguetown', 'East Blue'],
    [54, 'Warship Island', null], [62, 'Reverse Mountain', 'Arabasta'], [64, 'Whisky Peak', 'Arabasta'],
    [70, 'Little Garden', 'Arabasta'], [78, 'Drum Island', 'Arabasta'], [92, 'Arabasta', 'Arabasta'],
    [131, 'Post-Arabasta', null], [136, 'Goat Island', null], [139, 'Ruluka Island', null],
    [144, 'Jaya', 'Sky Island'], [153, 'Skypiea', 'Sky Island'], [196, 'G-8', null],
    [207, 'Long Ring Long Land', 'Water 7'], [220, "Ocean's Dream", null], [225, "Foxy's Return", null],
    [229, 'Water 7', 'Water 7'], [264, 'Enies Lobby', 'Water 7'], [313, 'Post-Enies Lobby', 'Water 7'],
    [326, 'Ice Hunter', null], [337, 'Thriller Bark', 'Thriller Bark'], [382, 'Spa Island', null],
    [385, 'Sabaody Archipelago', 'Summit War'], [408, 'Amazon Lily', 'Summit War'], [422, 'Impel Down', 'Summit War'],
    [457, 'Marineford', 'Summit War'], [490, 'Post-War', 'Summit War'], [517, 'Return to Sabaody', 'Fish-Man Island'],
    [523, 'Fish-Man Island', 'Fish-Man Island'], [575, "Z's Ambition", null], [579, 'Punk Hazard', 'Dressrosa'],
    [626, 'Caesar Retrieval', null], [629, 'Dressrosa', 'Dressrosa'], [747, 'Silver Mine', null],
    [751, 'Zou', 'Whole Cake Island'], [780, 'Marine Rookie', null], [783, 'Whole Cake Island', 'Whole Cake Island'],
    [878, 'Levely', 'Whole Cake Island'], [890, 'Wano Country', 'Wano Country'], [1086, 'Egghead', 'Final'],
    [1156, 'Elbaph', 'Final']
  ];

  // animefillerlist.com/shows/one-piece (1168 episodes); everything not listed is manga canon.
  const ONE_PIECE_TYPES = {
    mixed: '45-47,61,68-69,101,226,354,421,489,520,574,625,628,633,653,657,679,690,731,738,751,777-778,789,803,807,878-879,881-885,887-890,924,988-989,991',
    'anime-canon': '50-51,93,213-216,418-420,453-456,497-499,506,737,775,1084',
    filler: '54-60,98-99,102,131-143,196-206,220-225,279-283,291-292,303,317-319,326-336,382-384,406-407,426-429,457-458,492,542,575-578,590,626-627,747-750,780-782,895-896,907,1029-1030'
  };

  function expandRanges(spec) {
    const numbers = new Set();
    for (const part of spec.split(',')) {
      const [from, to = from] = part.split('-').map(Number);
      for (let n = from; n <= to; n += 1) numbers.add(n);
    }
    return numbers;
  }

  const ONE_PIECE_TYPE_SETS = Object.entries(ONE_PIECE_TYPES).map(([type, spec]) => [type, expandRanges(spec)]);

  function parseWatchPath(pathname) {
    const match = String(pathname ?? '').match(/^\/watch\/([^/]+)\/s(\d+)e(\d+)/);
    if (!match) return null;
    return { coreId: match[1], season: Number(match[2]), episode: Number(match[3]) };
  }

  function episodePath(coreId, season, episode) {
    return `/watch/${coreId}/s${season}e${episode}`;
  }

  function range(from, to) {
    return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
  }

  function blocks(from, to) {
    const arcs = [];
    for (let start = from, end; start <= to; start = end + 1) {
      end = Math.min(to, Math.ceil(start / BLOCK_SIZE) * BLOCK_SIZE);
      arcs.push({ key: `block-${start}`, name: null, from: start, to: end, episodes: range(start, end) });
    }
    return arcs;
  }

  function groupEpisodes({ coreId, maxEpisode }) {
    const max = Math.max(1, Math.floor(Number(maxEpisode) || 1));
    if (coreId !== ONE_PIECE_CORE_ID) return blocks(1, max);
    const arcs = [];
    ONE_PIECE_ARCS.forEach(([from, name, saga], index) => {
      if (from > max) return;
      const to = Math.min(max, (ONE_PIECE_ARCS[index + 1]?.[0] ?? Infinity) - 1);
      arcs.push({ key: `arc-${from}`, name, saga, filler: saga === null, from, to, episodes: range(from, to) });
    });
    return arcs;
  }

  function episodeType(coreId, episodeNumber) {
    if (coreId !== ONE_PIECE_CORE_ID) return null;
    for (const [type, numbers] of ONE_PIECE_TYPE_SETS) {
      if (numbers.has(episodeNumber)) return type;
    }
    return 'canon';
  }

  function recordKey(coreId, episodeNumber) {
    return `${coreId}:${episodeNumber}`;
  }

  function findRecord(records, coreId, episodeNumber) {
    const key = recordKey(coreId, episodeNumber);
    return (records ?? []).find((record) => record.episodeKey === key) ?? null;
  }

  function upsertProgress(records, { coreId, episodeNumber, positionSeconds, durationSeconds, completed = false, updatedAt }) {
    const key = recordKey(coreId, episodeNumber);
    const list = records ?? [];
    const index = list.findIndex((record) => record.episodeKey === key);
    if (!completed && index !== -1 && list[index].state === 'completed') return list;
    const record = {
      episodeKey: key,
      coreId,
      episodeNumber,
      state: completed ? 'completed' : 'in-progress',
      positionSeconds: completed ? durationSeconds : positionSeconds,
      durationSeconds,
      updatedAt
    };
    return index === -1 ? [...list, record] : list.map((item, itemIndex) => (itemIndex === index ? record : item));
  }

  function markCompleted(records, coreId, episodeNumbers, updatedAt) {
    let next = records ?? [];
    for (const episodeNumber of episodeNumbers) {
      const durationSeconds = findRecord(next, coreId, episodeNumber)?.durationSeconds ?? 0;
      next = upsertProgress(next, { coreId, episodeNumber, positionSeconds: durationSeconds, durationSeconds, completed: true, updatedAt });
    }
    return next;
  }

  function resolveStartPosition({ record, customStartSeconds, useResume }) {
    const floor = Math.max(0, Number(customStartSeconds) || 0);
    if (!useResume || record?.state !== 'in-progress') return floor;
    return Math.max(floor, Math.max(0, Number(record.positionSeconds) || 0));
  }

  function isEpisodeVideo(durationSeconds) {
    return Number.isFinite(durationSeconds) && durationSeconds >= MIN_EPISODE_SECONDS;
  }

  function shouldFinishPlayback({ eventType, currentTime, duration }) {
    if (eventType === 'ended') return true;
    if (eventType !== 'waiting' && eventType !== 'stalled') return false;
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const remaining = duration - currentTime;
    return remaining >= 0 && remaining <= 5;
  }

  // Window for the "next episode" button: episodes often end on credits or previews worth skipping.
  function isNearEnd({ currentTime, duration, windowSeconds = 30 }) {
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const remaining = duration - currentTime;
    return remaining > 0 && remaining <= windowSeconds;
  }

  globalObject.AnimPowCore = Object.freeze({
    ONE_PIECE_CORE_ID,
    parseWatchPath,
    episodePath,
    groupEpisodes,
    episodeType,
    findRecord,
    upsertProgress,
    markCompleted,
    resolveStartPosition,
    isEpisodeVideo,
    shouldFinishPlayback,
    isNearEnd
  });
})(globalThis);
