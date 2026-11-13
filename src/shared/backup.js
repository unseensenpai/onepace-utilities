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

  // Full setup (schema 2): every site's watch history and settings in one file. Schema 1 files
  // (OnePaceTR only) still import, as OnePaceTR data.
  const SETUP_SCHEMA_VERSION = 2;
  const SETUP_KEYS = {
    local: ['onepaceProgress', 'animpowProgress', 'animpowMaxEpisode', 'tranimeProgress'],
    sync: ['onepaceSettings', 'animpowSettings', 'tranimeSettings']
  };
  const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  function pickKeys(source, keys) {
    const picked = {};
    for (const key of keys) {
      if (source?.[key] !== undefined) picked[key] = source[key];
    }
    return picked;
  }

  function createSetupBackup({ local, sync, exportedAt = new Date().toISOString() }) {
    return {
      schemaVersion: SETUP_SCHEMA_VERSION,
      exportedAt,
      local: pickKeys(local, SETUP_KEYS.local),
      sync: pickKeys(sync, SETUP_KEYS.sync)
    };
  }

  function parseSetupBackup(text) {
    const backup = JSON.parse(text);
    if (backup?.schemaVersion === SCHEMA_VERSION) {
      const legacy = parseBackup(text);
      return { local: { onepaceProgress: legacy.progress }, sync: { onepaceSettings: legacy.settings } };
    }
    if (backup?.schemaVersion !== SETUP_SCHEMA_VERSION) throw new Error('Unsupported backup version');
    if (!isPlainObject(backup.local) || !isPlainObject(backup.sync)) throw new Error('Invalid backup data');
    return { local: pickKeys(backup.local, SETUP_KEYS.local), sync: pickKeys(backup.sync, SETUP_KEYS.sync) };
  }

  // AnimPow and TRanimeizle records carry their own episodeKey (site and show included).
  function isKeyedRecord(record) {
    return typeof record?.episodeKey === 'string' && record.episodeKey
      && Number.isInteger(record.episodeNumber) && record.episodeNumber > 0
      && (record.state === 'completed' || record.state === 'in-progress')
      && Number.isFinite(record.positionSeconds) && record.positionSeconds >= 0
      && Number.isFinite(record.durationSeconds) && record.durationSeconds >= 0;
  }

  function mergeKeyedRecords(currentRecords, importedRecords, summary) {
    const records = new Map((currentRecords ?? []).filter(isKeyedRecord).map((record) => [record.episodeKey, record]));
    for (const imported of importedRecords ?? []) {
      if (!isKeyedRecord(imported)) {
        summary.invalid += 1;
        continue;
      }
      const local = records.get(imported.episodeKey);
      if (!local) {
        records.set(imported.episodeKey, imported);
        summary.added += 1;
      } else if (local.state === 'completed' && imported.state !== 'completed') {
        summary.keptCompleted += 1;
      } else if (shouldUseImported(local, imported)) {
        records.set(imported.episodeKey, imported);
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
      }
    }
    return [...records.values()];
  }

  // AnimPow and TRanimeizle settings are flat flags and numbers.
  function sanitizeFlatSettings(importedSettings) {
    const sanitized = {};
    for (const [key, value] of Object.entries(isPlainObject(importedSettings) ? importedSettings : {})) {
      if (typeof value === 'boolean' || (Number.isFinite(value) && value >= 0)) sanitized[key] = value;
    }
    return sanitized;
  }

  // Returns the storage values to write (only the keys the backup carries) and a combined summary.
  function mergeSetup(current, backup) {
    const summary = { added: 0, updated: 0, keptCompleted: 0, unchanged: 0, invalid: 0 };
    const local = {};
    const sync = {};
    if (Array.isArray(backup.local.onepaceProgress)) {
      const merged = mergeProgressRecords(current.local?.onepaceProgress, backup.local.onepaceProgress);
      for (const key of Object.keys(summary)) summary[key] += merged.summary[key];
      local.onepaceProgress = merged.records;
    }
    for (const key of ['animpowProgress', 'tranimeProgress']) {
      if (Array.isArray(backup.local[key])) local[key] = mergeKeyedRecords(current.local?.[key], backup.local[key], summary);
    }
    if (Number.isFinite(backup.local.animpowMaxEpisode)) {
      local.animpowMaxEpisode = Math.max(Number(current.local?.animpowMaxEpisode) || 0, backup.local.animpowMaxEpisode);
    }
    if (isPlainObject(backup.sync.onepaceSettings)) {
      sync.onepaceSettings = { ...current.sync?.onepaceSettings, ...sanitizeSettings(backup.sync.onepaceSettings) };
    }
    for (const key of ['animpowSettings', 'tranimeSettings']) {
      if (isPlainObject(backup.sync[key])) sync[key] = { ...current.sync?.[key], ...sanitizeFlatSettings(backup.sync[key]) };
    }
    return { local, sync, summary };
  }

  // Browser side, shared by every site's settings drawer.
  function readStorage(area, keys) {
    return new Promise((resolve) => chrome.storage[area].get(keys, resolve));
  }

  async function exportSetup() {
    const [local, sync] = await Promise.all([readStorage('local', SETUP_KEYS.local), readStorage('sync', SETUP_KEYS.sync)]);
    const backup = createSetupBackup({ local, sync });
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `onepace-utilities-setup-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // confirmMerge(summary) decides whether to write; resolves true once the data is stored.
  async function importSetup(file, confirmMerge) {
    const backup = parseSetupBackup(await file.text());
    const [local, sync] = await Promise.all([readStorage('local', SETUP_KEYS.local), readStorage('sync', SETUP_KEYS.sync)]);
    const merged = mergeSetup({ local, sync }, backup);
    if (!confirmMerge(merged.summary)) return false;
    await Promise.all([
      new Promise((resolve) => chrome.storage.local.set(merged.local, resolve)),
      new Promise((resolve) => chrome.storage.sync.set(merged.sync, resolve))
    ]);
    return true;
  }

  const SETUP_TEXT = {
    prompt: 'Yedek mevcut verilerle birleştirilecek. Devam edilsin mi?',
    added: 'Yeni bölüm',
    updated: 'Güncellenen bölüm',
    kept: 'Korunan tamamlanmış bölüm',
    invalid: 'Atlanan geçersiz kayıt',
    success: 'Yedek başarıyla içe aktarıldı.',
    error: 'Yedek dosyası okunamadı veya geçersiz.'
  };

  // Wires [data-action="export-setup"], [data-action="import-setup"] and [data-input="setup"] inside
  // root. The page reloads after an import so every open panel picks up the merged data.
  function bindSetupControls(root, text = SETUP_TEXT) {
    const input = root.querySelector('[data-input="setup"]');
    root.querySelector('[data-action="export-setup"]').addEventListener('click', () => exportSetup());
    root.querySelector('[data-action="import-setup"]').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        const imported = await importSetup(file, (summary) => confirm(`${text.prompt}\n\n${text.added}: ${summary.added}\n${text.updated}: ${summary.updated}\n${text.kept}: ${summary.keptCompleted}\n${text.invalid}: ${summary.invalid}`));
        if (!imported) return;
        alert(text.success);
        location.reload();
      } catch {
        alert(text.error);
      }
    });
  }

  globalObject.OnePaceBackup = Object.freeze({
    bindSetupControls,
    createBackup,
    mergeProgressRecords,
    parseBackup,
    sanitizeSettings,
    createSetupBackup,
    parseSetupBackup,
    mergeSetup,
    exportSetup,
    importSetup
  });
})(globalThis);
