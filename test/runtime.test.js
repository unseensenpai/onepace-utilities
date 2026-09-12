import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

import { hasExtensionRuntime } from '../src/shared/runtime.js';

test('returns false when a reloaded extension has no runtime messaging API', () => {
  assert.equal(hasExtensionRuntime({}), false);
  assert.equal(hasExtensionRuntime({ runtime: {} }), false);
});

test('returns true when runtime messaging is available', () => {
  assert.equal(hasExtensionRuntime({ runtime: { sendMessage() {} } }), true);
});

test('guards iframe event delivery when a reloaded extension invalidates runtime messaging', async () => {
  const playerFrame = await readFile(new URL('../src/content/player-frame.js', import.meta.url), 'utf8');
  assert.match(playerFrame, /typeof chrome\?\.runtime\?\.sendMessage !== 'function'/);
});

test('loads the page content script without module syntax', async () => {
  const contentScript = await readFile(new URL('../src/content/content.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(contentScript));
});

test('content script scrolls the active episode row below its sticky arc heading', async () => {
  const contentScript = await readFile(new URL('../src/content/content.js', import.meta.url), 'utf8');
  const context = {
    chrome: {
      storage: {
        local: { get(_key, callback) { callback({}); }, set(_value, callback) { callback?.(); } },
        sync: { get(_key, callback) { callback({}); }, set(_value, callback) { callback?.(); } }
      },
      runtime: { onMessage: { addListener() {} }, sendMessage() {} }
    },
    document: {
      documentElement: {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    location: { pathname: '/bolum/188' },
    MutationObserver: class { observe() {} },
    window: { addEventListener() {} }
  };

  vm.runInNewContext(`${contentScript}\nconst scroller = { scrollTop: 480, getBoundingClientRect: () => ({ top: 80 }) };\nconst activeArc = { querySelector: selector => ({ getBoundingClientRect: () => ({ height: selector.includes('summary') ? 34 : 96 }) }), style: { setProperty() {} } };\nfocusActiveEpisodeRow({ arcScroller: scroller, activeArc, activeCard: { getBoundingClientRect: () => ({ top: 220 }) } });\nglobalThis.focusedScrollTop = scroller.scrollTop;`, context);

  assert.equal(context.focusedScrollTop, 482);
});

function footerInfo(label, value) {
  return {
    querySelectorAll() {
      return [{ textContent: label }, { textContent: value }];
    }
  };
}

test('reads manga and anime references from the active episode footer', async () => {
  const contentScript = await readFile(new URL('../src/content/content.js', import.meta.url), 'utf8');
  const footer = [footerInfo('Manga', '322-323'), footerInfo('Anime', '228')];
  const context = {
    chrome: {
      storage: {
        local: { get(_key, callback) { callback({}); }, set(_value, callback) { callback?.(); } },
        sync: { get(_key, callback) { callback({}); }, set(_value, callback) { callback?.(); } }
      },
      runtime: { onMessage: { addListener() {} }, sendMessage() {} }
    },
    document: {
      documentElement: {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll(selector) { return selector === '.episode-detail .infos .info' ? footer : []; }
    },
    location: { pathname: '/bolum/123' },
    MutationObserver: class { observe() {} },
    window: { addEventListener() {} }
  };

  vm.runInNewContext(`${contentScript}\nglobalThis.episodeInfo = getEpisodeInfo();`, context);
  assert.equal(context.episodeInfo.manga, '322-323');
  assert.equal(context.episodeInfo.anime, '228');
});
