import test from 'node:test';
import assert from 'node:assert/strict';

import { translate } from '../src/shared/i18n.js';

test('returns Spanish extension labels when Spanish is selected', () => {
  assert.equal(translate('es', 'arcMaster'), 'MAESTRO DE ARCOS');
  assert.equal(translate('es', 'settings'), 'Ajustes');
});

test('falls back to Turkish for an unsupported language', () => {
  assert.equal(translate('unsupported', 'markCompleted'), 'Bu bölümü izlendi olarak işaretle');
});

test('uses natural viewing labels for episode and arc progress actions in every language', () => {
  assert.equal(translate('tr', 'markThroughCurrent'), 'Bu bölüme kadar tümünü izlendi olarak işaretle');
  assert.equal(translate('en', 'markThroughCurrent'), 'Mark everything through this episode as watched');
  assert.equal(translate('es', 'markThroughCurrent'), 'Marcar como visto todo hasta este episodio');
  assert.equal(translate('tr', 'markArcCompleted'), "Bu arc'taki tüm bölümleri izlendi olarak işaretle");
});
