(function initializeBackupApi(globalObject) {
  const SCHEMA_VERSION = 1;

  function normalizeRecord(record) {
    const episodeNumber = record?.episodeNumber;
    if (typeof episodeNumber !== 'number' || !Number.isInteger(episodeNumber) || episodeNumber <= 0) return null;
    if (record.state !== 'completed' && record.state !== 'in-progress') return null;
    if (typeof record.positionSeconds !== 'number'
      || !Number.isFinite(record.positionSeconds)
      || record.positionSeconds < 0) return null;
    if (typeof record.durationSeconds !== 'number'
      || !Number.isFinite(record.durationSeconds)
      || record.durationSeconds < 0) return null;
    const positionSeconds = record.positionSeconds;
    const durationSeconds = record.durationSeconds;
    const updatedAt = typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt))
      ? record.updatedAt
      : '';
    return {
      episodeKey: typeof record.episodeKey === 'string' && record.episodeKey
        ? record.episodeKey
        : `episode-${episodeNumber}`,
      episodeNumber,
      state: record.state,
      positionSeconds,
      durationSeconds,
      updatedAt
    };
  }

  function shouldUseImported(localRecord, importedRecord) {
    if (localRecord.state !== importedRecord.state) return importedRecord.state === 'completed';
    const localTime = Date.parse(localRecord.updatedAt);
    const importedTime = Date.parse(importedRecord.updatedAt);
    if (Number.isFinite(localTime) && Number.isFinite(importedTime) && localTime !== importedTime) {
      return importedTime > localTime;
    }
    return importedRecord.positionSeconds > localRecord.positionSeconds;
  }

  function mergeProgressRecords(currentRecords, importedRecords) {
    const recordsByEpisode = new Map();
    for (const record of currentRecords ?? []) {
      const normalized = normalizeRecord(record);
      if (normalized) recordsByEpisode.set(normalized.episodeNumber, normalized);
    }

    const summary = { added: 0, updated: 0, keptCompleted: 0, unchanged: 0, invalid: 0 };
    for (const record of importedRecords ?? []) {
      const imported = normalizeRecord(record);
      if (!imported) {
        summary.invalid += 1;
        continue;
      }
      const local = recordsByEpisode.get(imported.episodeNumber);
      if (!local) {
        recordsByEpisode.set(imported.episodeNumber, imported);
        summary.added += 1;
        continue;
      }
      if (local.state === 'completed' && imported.state !== 'completed') {
        summary.keptCompleted += 1;
        continue;
      }
      if (shouldUseImported(local, imported)) {
        recordsByEpisode.set(imported.episodeNumber, imported);
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
      }
    }

    return {
      records: [...recordsByEpisode.values()].sort((left, right) => left.episodeNumber - right.episodeNumber),
      summary
    };
  }

  function createBackup({ progress, settings, exportedAt = new Date().toISOString() }) {
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      progress: Array.isArray(progress) ? progress : [],
      settings: settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
    };
  }

  function parseBackup(text) {
    const backup = JSON.parse(text);
    if (!backup || backup.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported backup version');
    if (!Array.isArray(backup.progress) || !backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) {
      throw new Error('Invalid backup data');
    }
    return backup;
  }

  function sanitizeSettings(importedSettings) {
    const sanitized = {};
    for (const key of ['autoAdvance', 'useResume', 'arcMasterOpen']) {
      if (typeof importedSettings?.[key] === 'boolean') sanitized[key] = importedSettings[key];
    }
    if ([1, 1.25, 1.5, 2].includes(importedSettings?.playbackRate)) {
      sanitized.playbackRate = importedSettings.playbackRate;
    }
    if (Number.isFinite(importedSettings?.customStartSeconds) && importedSettings.customStartSeconds >= 0) {
      sanitized.customStartSeconds = importedSettings.customStartSeconds;
    }
    if (['tr', 'en', 'es'].includes(importedSettings?.language)) {
      sanitized.language = importedSettings.language;
    }
    return sanitized;
  }

  globalObject.OnePaceBackup = Object.freeze({
    createBackup,
    mergeProgressRecords,
    parseBackup,
    sanitizeSettings
  });
})(globalThis);
