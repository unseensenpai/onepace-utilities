import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function runPlayerFrame({ ranges = [], hostname = 'video.sibnet.ru', menuButtons = [] } = {}) {
  const source = await readFile(new URL('../src/content/player-frame.js', import.meta.url), 'utf8');
  const videoListeners = new Map();
  const sentMessages = [];
  let runtimeListener = null;
  let intervalCallback = null;
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
      querySelector(selector) { return selector === 'video' ? video : null; },
      querySelectorAll(selector) {
        if (selector === 'input[type="range"]') return ranges;
        if (selector === 'button[aria-haspopup="menu"]') return menuButtons;
        return [];
      }
    },
    location: { hostname },
    Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class {
      constructor() {}
      observe() {}
    },
    setInterval(callback) { intervalCallback = callback; return 1; },
    clearInterval() { intervalCallback = null; }
  };

  vm.runInNewContext(source, context);
  return { getIntervalCallback: () => intervalCallback, runtimeListener, sentMessages, video, videoListeners };
}

async function runGoogleDriveFrame() {
  const source = await readFile(new URL('../src/content/player-frame.js', import.meta.url), 'utf8');
  const sentMessages = [];
  const dispatchedEvents = [];
  let runtimeListener = null;
  let mutationCallback = null;
  let intervalCallback = null;
  let menuOpen = false;
  let timelineAvailable = true;
  let speedOptionClicks = 0;
  let unrelatedOptionClicks = 0;

  const timeline = {
    value: '10000',
    max: '1845000',
    dataset: {},
    dispatchEvent(event) { dispatchedEvents.push(event.type); }
  };
  const volume = { value: '100', max: '100', dataset: {} };
  const speedButton = {
    textContent: '1 kat',
    attributes: { 'aria-label': '1 kat', 'aria-expanded': 'false' },
    getAttribute(name) { return this.attributes[name] ?? null; },
    click() {
      menuOpen = true;
      this.attributes['aria-expanded'] = 'true';
    },
    closest() { return speedContainer; }
  };
  const speedOption = {
    textContent: '2',
    click() {
      speedOptionClicks += 1;
      speedButton.textContent = '2 kat';
      speedButton.attributes['aria-label'] = '2 kat';
      speedButton.attributes['aria-expanded'] = 'false';
      menuOpen = false;
    }
  };
  const unrelatedOption = {
    textContent: '2',
    click() { unrelatedOptionClicks += 1; }
  };
  const speedContainer = {
    querySelectorAll(selector) {
      return selector === '[role="menuitemradio"]' && menuOpen ? [speedOption] : [];
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
      querySelector(selector) { return selector === 'video' ? null : null; },
      querySelectorAll(selector) {
        if (selector === 'input[type="range"]') return timelineAvailable ? [timeline, volume] : [];
        if (selector === 'button[aria-haspopup="menu"]') return [speedButton];
        if (selector === '[role="menuitemradio"]') return menuOpen ? [unrelatedOption, speedOption] : [];
        return [];
      }
    },
    location: { hostname: 'drive.google.com' },
    Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
    },
    setInterval(callback) { intervalCallback = callback; return 1; },
    clearInterval() { intervalCallback = null; }
  };

  vm.runInNewContext(source, context);
  return {
    dispatchedEvents,
    getIntervalCallback: () => intervalCallback,
    removeTimeline() { timelineAvailable = false; },
    mutationCallback,
    runtimeListener,
    sentMessages,
    speedButton,
    getSpeedOptionClicks: () => speedOptionClicks,
    getUnrelatedOptionClicks: () => unrelatedOptionClicks,
    timeline
  };
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

test('does not activate the Google Drive adapter in a native Sibnet frame with range controls', async () => {
  const range = { value: '10000', max: '1845000', dataset: {} };
  const frame = await runPlayerFrame({ ranges: [range] });

  assert.equal(frame.getIntervalCallback(), null);
});

test('does not apply Google Drive controls when a Drive frame exposes a native video', async () => {
  const dispatchedEvents = [];
  const range = {
    value: '10000',
    max: '1845000',
    dataset: {},
    dispatchEvent(event) { dispatchedEvents.push(event.type); }
  };
  let speedClicks = 0;
  const speedButton = {
    textContent: '1 kat',
    getAttribute(name) { return name === 'aria-label' ? '1 kat' : 'false'; },
    click() { speedClicks += 1; }
  };
  const frame = await runPlayerFrame({
    hostname: 'drive.google.com',
    menuButtons: [speedButton],
    ranges: [range]
  });

  frame.runtimeListener({
    type: 'ONEPACE_PLAYER_PREFERENCES',
    payload: { playbackRate: 2, startAtSeconds: 117 }
  });

  assert.deepEqual(dispatchedEvents, []);
  assert.equal(speedClicks, 0);
  assert.equal(frame.getIntervalCallback(), null);
});

test('applies start position and playback rate through Google Drive controls without a video element', async () => {
  const drive = await runGoogleDriveFrame();
  drive.runtimeListener({
    type: 'ONEPACE_PLAYER_PREFERENCES',
    payload: { playbackRate: 2, startAtSeconds: 117 }
  });

  assert.equal(drive.timeline.value, '117000');
  assert.deepEqual(drive.dispatchedEvents, ['input', 'change']);
  if (drive.getSpeedOptionClicks() === 0) drive.mutationCallback();
  assert.equal(drive.getSpeedOptionClicks(), 1);
  assert.equal(drive.getUnrelatedOptionClicks(), 0);
  assert.equal(drive.speedButton.getAttribute('aria-label'), '2 kat');
});

test('reports Google Drive progress and completes once from its millisecond timeline', async () => {
  const drive = await runGoogleDriveFrame();
  drive.runtimeListener({
    type: 'ONEPACE_PLAYER_PREFERENCES',
    payload: { playbackRate: 2 }
  });

  drive.timeline.value = '600000';
  drive.getIntervalCallback()();
  const position = drive.sentMessages.find((message) => message.event === 'position')?.detail;
  assert.equal(position?.positionSeconds, 600);
  assert.equal(position?.durationSeconds, 1845);

  drive.timeline.value = '1842000';
  drive.getIntervalCallback()();
  assert.equal(drive.sentMessages.some((message) => message.event === 'ended'), false);

  drive.timeline.value = '1845000';
  drive.getIntervalCallback()();
  assert.equal(drive.sentMessages.filter((message) => message.event === 'ended').length, 1);
});

test('stops Google Drive polling when its timeline is removed', async () => {
  const drive = await runGoogleDriveFrame();
  assert.equal(typeof drive.getIntervalCallback(), 'function');

  drive.removeTimeline();
  drive.mutationCallback();

  assert.equal(drive.getIntervalCallback(), null);
});
