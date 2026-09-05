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

  return records.map((record, index) =>
    index === existingIndex ? { ...record, ...nextRecord } : record
  );
}

export function getLatestIncomplete(records) {
  return records
    .filter((record) => record.state === 'in-progress')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}
