import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function runPlayerFrame() {
  const source = await readFile(new URL('../src/content/player-frame.js', import.meta.url), 'utf8');
  const videoListeners = new Map();
  const sentMessages = [];
  let runtimeListener = null;
  const video = {
    currentTime: 10,
    duration: 1845,
    playbackRate: 1,
    dataset: {},
    addEventListener(type, listener) {
      videoListeners.set(type, listener);
    }
  };
  const context = {
    chrome: {
      runtime: {
        sendMessage(message) { sentMessages.push(message); },
        onMessage: { addListener(listener) { runtimeListener = listener; } }
      }
    },
    document: {
      documentElement: {},
      querySelector(selector) { return selector === 'video' ? video : null; }
    },
    MutationObserver: class {
      constructor() {}
      observe() {}
    }
  };

  vm.runInNewContext(source, context);
  return { runtimeListener, sentMessages, video, videoListeners };
}

test('announces that the player frame is ready for preferences', async () => {
  const { sentMessages } = await runPlayerFrame();
  assert.equal(sentMessages[0]?.type, 'ONEPACE_PLAYER_READY');
});

test('does not emit early progress before initial preferences arrive', async () => {
  const { sentMessages, videoListeners } = await runPlayerFrame();
  videoListeners.get('timeupdate')();
  assert.equal(sentMessages.some((message) => message.event === 'position'), false);
});

test('applies the initial start once and does not override later manual seeking', async () => {
  const { runtimeListener, video } = await runPlayerFrame();
  runtimeListener({
    type: 'ONEPACE_PLAYER_PREFERENCES',
    payload: { playbackRate: 2, startAtSeconds: 117 }
  });
  assert.equal(video.currentTime, 117);
  assert.equal(video.playbackRate, 2);

  video.currentTime = 500;
  runtimeListener({
    type: 'ONEPACE_PLAYER_PREFERENCES',
    payload: { playbackRate: 2, startAtSeconds: 117 }
  });
  assert.equal(video.currentTime, 500);
});

test('emits completion once when the provider stalls in the final five seconds', async () => {
  const { runtimeListener, sentMessages, video, videoListeners } = await runPlayerFrame();
  runtimeListener({
    type: 'ONEPACE_PLAYER_PREFERENCES',
    payload: { playbackRate: 2, startAtSeconds: 117 }
  });
  video.currentTime = 1842;
  videoListeners.get('waiting')();
  videoListeners.get('stalled')();

  assert.equal(sentMessages.filter((message) => message.event === 'ended').length, 1);
});
