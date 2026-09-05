import test from 'node:test';
import assert from 'node:assert/strict';

import { translate } from '../src/shared/i18n.js';

test('returns Spanish extension labels when Spanish is selected', () => {
  assert.equal(translate('es', 'arcMaster'), 'MAESTRO DE ARCOS');
  assert.equal(translate('es', 'settings'), 'Ajustes');
});

test('falls back to Turkish for an unsupported language', () => {
  assert.equal(translate('unsupported', 'markCompleted'), 'Bölümü tamamlandı yap');
});
