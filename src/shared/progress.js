export function createProgressRecord({
  episodeKey,
  episodeNumber,
  positionSeconds,
  durationSeconds,
  updatedAt
}) {
  return {
    episodeKey,
    episodeNumber,
    state: 'in-progress',
    positionSeconds,
    durationSeconds,
    updatedAt
  };
}

export function upsertProgressRecord(records, input) {
  const nextRecord = createProgressRecord(input);
  const existingIndex = records.findIndex(
    (record) => record.episodeKey === nextRecord.episodeKey
  );

  if (existingIndex === -1) {
    return [...records, nextRecord];
  }

  if (records[existingIndex].state === 'completed') {
    return records;
  }

  return records.map((record, index) =>
    index === existingIndex ? { ...record, ...nextRecord } : record
  );
}

export function getLatestIncomplete(records) {
  return records
    .filter((record) => record.state === 'in-progress')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function markEpisodesCompleted(records, episodes, updatedAt) {
  const existingByNumber = new Map(records.map((record) => [record.episodeNumber, record]));
  const selectedNumbers = new Set(episodes.map((episode) => episode.number));
  const completed = episodes.map((episode) => {
    const existing = existingByNumber.get(episode.number);
    const durationSeconds = episode.durationSeconds ?? existing?.durationSeconds ?? 0;
    return {
      episodeKey: existing?.episodeKey ?? `episode-${episode.number}`,
      episodeNumber: episode.number,
      state: 'completed',
      positionSeconds: durationSeconds,
      durationSeconds,
      updatedAt
    };
  });

  return [
    ...records.filter((record) => !selectedNumbers.has(record.episodeNumber)),
    ...completed
  ];
}
