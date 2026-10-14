const core = globalThis.AnimPowCore;
const PANEL_ID = 'apw-panel';
const TOGGLE_ID = 'apw-toggle';
const SETTINGS_ID = 'apw-settings';
const NEXT_PROMPT_ID = 'apw-next';
const PROGRESS_KEY = 'animpowProgress';
const SETTINGS_KEY = 'animpowSettings';
const MAX_EPISODE_KEY = 'animpowMaxEpisode';
const SEEK_STEP_SECONDS = 15;
const DEFAULT_SETTINGS = {
  focusMode: true,
  panelOpen: true,
  playbackRate: 1,
  customStartSeconds: 0,
  useResume: true,
  autoAdvance: true,
  blockSocket: false
};
const TYPE_LABELS = { canon: 'Canon', mixed: 'Karışık', filler: 'Filler', 'anime-canon': 'Anime canon' };

let settings = { ...DEFAULT_SETTINGS };
let progressRecords = [];
let maxEpisodeSeen = 0;
let initialized = false;
let renderedPath = null;
let startAppliedFor = null;
let completionSentFor = null;
let lastPositionSave = 0;
let autoAdvanceTimer = null;
let nextPromptDismissedFor = null;

function getStorage(area, key) {
  return new Promise((resolve) => chrome.storage[area].get(key, (value) => resolve(value[key])));
}

function setStorage(area, value) {
  return new Promise((resolve) => chrome.storage[area].set(value, resolve));
}

function saveSettings() {
  return setStorage('sync', { [SETTINGS_KEY]: settings });
}

function saveRecords() {
  return setStorage('local', { [PROGRESS_KEY]: progressRecords });
}

function getContext() {
  return core.parseWatchPath(location.pathname);
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function isInsideAd(element) {
  return Boolean(element.closest('[id*="ima" i], [class*="ima-" i], [class*="ad-container" i], [id*="ad-container" i]'));
}

function findEpisodeVideo() {
  let best = null;
  let bestArea = 0;
  for (const video of document.querySelectorAll('video')) {
    if (isInsideAd(video)) continue;
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = video;
      bestArea = area;
    }
  }
  return best;
}

function findPlayerBox(video) {
  const videoRect = video.getBoundingClientRect();
  let box = video;
  while (box.parentElement && box.parentElement !== document.body) {
    const rect = box.parentElement.getBoundingClientRect();
    if (rect.height > videoRect.height * 1.25 || rect.width > videoRect.width * 1.1) break;
    box = box.parentElement;
  }
  return box;
}

// Keeps the site's "Çeviri ve Kaynak Seçimi" card visible under the player, and nothing else from
// the hidden block it sits in (comments etc.).
function revealSourcePicker() {
  const label = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div')]
    .find((element) => element.children.length === 0 && /kaynak seçimi/i.test(element.textContent));
  if (!label) return;
  let card = label;
  while (card.parentElement && !card.querySelector('button')) card = card.parentElement;
  let top = card;
  while (top && top.dataset.apw !== 'hidden') top = top.parentElement;
  if (!top) return;
  for (let node = card; node !== top; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node) sibling.dataset.apw = 'hidden';
    }
  }
  top.dataset.apw = 'source';
}

// Only data attributes are written into the site's DOM: React owns className and the tree.
function applyFocusLayout(video) {
  document.querySelectorAll('[data-apw]').forEach((element) => element.removeAttribute('data-apw'));
  const playerBox = findPlayerBox(video);
  playerBox.dataset.apw = 'player';
  for (let node = playerBox; node.parentElement && node !== document.body; node = node.parentElement) {
    if (node !== playerBox) node.dataset.apw = 'keep';
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.id?.startsWith('apw-') || sibling.tagName === 'SCRIPT') continue;
      sibling.dataset.apw = 'hidden';
    }
  }
  revealSourcePicker();
}

// The site's own episode list loads late, so this runs on every DOM change; returns true when it grew.
function updateMaxEpisode(context) {
  let max = Math.max(maxEpisodeSeen, context.episode);
  const prefix = `/watch/${context.coreId}/`;
  for (const anchor of document.querySelectorAll(`a[href*="${prefix}"]:not(#${PANEL_ID} a)`)) {
    const parsed = core.parseWatchPath(new URL(anchor.href, location.origin).pathname);
    if (parsed?.coreId === context.coreId) max = Math.max(max, parsed.episode);
  }
  if (max === maxEpisodeSeen) return false;
  maxEpisodeSeen = max;
  setStorage('local', { [MAX_EPISODE_KEY]: maxEpisodeSeen });
  return true;
}

function recordFor(context, episodeNumber = context.episode) {
  return core.findRecord(progressRecords, context.coreId, episodeNumber);
}

function saveProgress(context, positionSeconds, durationSeconds, completed = false) {
  progressRecords = core.upsertProgress(progressRecords, {
    coreId: context.coreId,
    episodeNumber: context.episode,
    positionSeconds: Math.floor(positionSeconds),
    durationSeconds: Math.floor(durationSeconds),
    completed,
    updatedAt: new Date().toISOString()
  });
  saveRecords();
}

function markCompleted(context, episodeNumbers) {
  progressRecords = core.markCompleted(progressRecords, context.coreId, episodeNumbers, new Date().toISOString());
  saveRecords();
  render(true);
}

function applyPlayerPreferences(video, context) {
  if (!video || !core.isEpisodeVideo(video.duration)) return;
  video.playbackRate = Number(settings.playbackRate) || 1;
  const key = `${context.coreId}:${context.episode}`;
  if (startAppliedFor === key) return;
  startAppliedFor = key;
  const start = core.resolveStartPosition({
    record: recordFor(context),
    customStartSeconds: settings.customStartSeconds,
    useResume: settings.useResume
  });
  if (start > 0 && start < video.duration - 1) video.currentTime = start;
}

function handleCompletion(video, eventType) {
  const context = getContext();
  if (!context || !core.isEpisodeVideo(video.duration)) return;
  if (!core.shouldFinishPlayback({ eventType, currentTime: video.currentTime, duration: video.duration })) return;
  const key = `${context.coreId}:${context.episode}`;
  if (completionSentFor === key) return;
  completionSentFor = key;
  removeNextPrompt();
  saveProgress(context, video.duration, video.duration, true);
  render(true);
  if (settings.autoAdvance && context.episode < maxEpisodeSeen) beginAutoAdvance(context);
}

function removeNextPrompt() {
  document.getElementById(NEXT_PROMPT_ID)?.remove();
}

function goToNextEpisode(video, context) {
  clearTimeout(autoAdvanceTimer);
  completionSentFor = `${context.coreId}:${context.episode}`;
  saveProgress(context, video.duration, video.duration, true);
  location.href = episodeLink(context, context.episode + 1);
}

// Shown over the player's bottom-right corner during the last 30 seconds; it lives outside the site's
// DOM (inside the fullscreen element when there is one) and follows the video's on-screen position.
function updateNextPrompt(video, context) {
  const key = `${context.coreId}:${context.episode}`;
  const show = context.episode < maxEpisodeSeen && completionSentFor !== key && nextPromptDismissedFor !== key
    && core.isNearEnd({ currentTime: video.currentTime, duration: video.duration });
  let prompt = document.getElementById(NEXT_PROMPT_ID);
  if (!show) {
    prompt?.remove();
    return;
  }
  const host = document.fullscreenElement ?? document.body;
  if (!prompt || prompt.parentElement !== host) {
    prompt?.remove();
    prompt = document.createElement('div');
    prompt.id = NEXT_PROMPT_ID;
    prompt.innerHTML = `<button type="button" data-action="next">${context.episode + 1}. bölüme geç ▶</button><button type="button" data-action="dismiss" aria-label="Kapat">×</button>`;
    prompt.querySelector('[data-action="next"]').addEventListener('click', () => goToNextEpisode(video, context));
    prompt.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
      nextPromptDismissedFor = key;
      prompt.remove();
    });
    host.append(prompt);
  }
  const rect = video.getBoundingClientRect();
  prompt.style.right = `${Math.max(0, window.innerWidth - rect.right) + 24}px`;
  prompt.style.bottom = `${Math.max(0, window.innerHeight - rect.bottom) + 72}px`;
}

function bindVideo(video) {
  if (!video || video.dataset.apwBound) return;
  video.dataset.apwBound = 'true';
  const apply = () => {
    const context = getContext();
    if (context) applyPlayerPreferences(video, context);
  };
  video.addEventListener('loadedmetadata', apply);
  video.addEventListener('durationchange', apply);
  video.addEventListener('play', apply);
  video.addEventListener('timeupdate', () => {
    const context = getContext();
    if (!context || !core.isEpisodeVideo(video.duration)) return;
    updateNextPrompt(video, context);
    const now = Date.now();
    if (now - lastPositionSave < 5000) return;
    lastPositionSave = now;
    saveProgress(context, video.currentTime, video.duration);
  });
  for (const eventType of ['ended', 'waiting', 'stalled']) {
    video.addEventListener(eventType, () => handleCompletion(video, eventType));
  }
  apply();
}

function seekBy(seconds) {
  const video = findEpisodeVideo();
  if (!video || !core.isEpisodeVideo(video.duration)) return;
  video.currentTime = Math.min(Math.max(0, video.currentTime + seconds), video.duration - 0.5);
}

function setPlaybackRate(rate) {
  settings.playbackRate = rate;
  saveSettings();
  const video = findEpisodeVideo();
  if (video && core.isEpisodeVideo(video.duration)) video.playbackRate = rate;
  render(true);
}

function beginAutoAdvance(context) {
  clearTimeout(autoAdvanceTimer);
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  const next = context.episode + 1;
  let remaining = 5;
  const notice = document.createElement('div');
  notice.className = 'apw-countdown';
  notice.innerHTML = `<span></span><button type="button">İptal</button>`;
  const label = notice.querySelector('span');
  const update = () => { label.textContent = `${next}. bölüm ${remaining} sn içinde başlıyor`; };
  update();
  panel.prepend(notice);
  const interval = setInterval(() => {
    remaining -= 1;
    update();
  }, 1000);
  notice.querySelector('button').addEventListener('click', () => {
    clearInterval(interval);
    clearTimeout(autoAdvanceTimer);
    notice.remove();
  });
  autoAdvanceTimer = setTimeout(() => {
    clearInterval(interval);
    location.href = core.episodePath(context.coreId, context.season, next);
  }, 5000);
}

function episodeLink(context, number) {
  return core.episodePath(context.coreId, context.season, number);
}

function arcLabel(arc) {
  return arc.name ?? `Bölüm ${arc.from}–${arc.to}`;
}

function episodeGrid(context, arc) {
  return `<div class="apw-grid">${arc.episodes.map((number) => {
    const record = recordFor(context, number);
    const type = core.episodeType(context.coreId, number);
    const mark = record?.state === 'completed' ? '✓ ' : record?.state === 'in-progress' ? '◐ ' : '';
    const classes = ['apw-episode', record?.state ?? 'unseen', type ? `apw-type-${type}` : '', number === context.episode ? 'active' : ''].join(' ');
    return `<a class="${classes}" href="${episodeLink(context, number)}" title="${type ? TYPE_LABELS[type] : ''}"><strong>${mark}${number}</strong></a>`;
  }).join('')}</div>`;
}

function renderArcs(context, arcs) {
  return arcs.map((arc) => {
    const active = context.episode >= arc.from && context.episode <= arc.to;
    const completed = arc.episodes.filter((number) => recordFor(context, number)?.state === 'completed').length;
    const state = completed === arc.episodes.length ? 'completed' : active ? 'active' : 'untouched';
    const actions = active ? `<div class="apw-arc-actions">
        <button type="button" data-action="complete-current">✓ Bu bölümü izlendi işaretle</button>
        <button type="button" data-action="complete-through">✓ Buraya kadar izlendi</button>
        <button type="button" data-action="reset-current">↺ İlerlemeyi sıfırla</button>
      </div>` : '';
    const grid = active ? episodeGrid(context, arc) : '';
    return `<details class="apw-arc apw-arc-${state}" data-arc-key="${arc.key}" ${active ? 'open' : ''}>
      <summary><span>${arcLabel(arc)}</span><small>${completed} / ${arc.episodes.length}</small></summary>
      ${actions}${grid}
    </details>`;
  }).join('');
}

function renderSettings() {
  document.getElementById(SETTINGS_ID)?.remove();
  const drawer = document.createElement('aside');
  drawer.id = SETTINGS_ID;
  drawer.hidden = true;
  drawer.innerHTML = `
    <header><strong>Ayarlar</strong><button type="button" data-action="close-settings">×</button></header>
    <label><input type="checkbox" data-setting="useResume" ${settings.useResume ? 'checked' : ''}> Kaldığın yerden devam et</label>
    <label>Yeni bölüm başlangıcı <span><input type="number" min="0" step="5" data-setting="customStartSeconds" value="${settings.customStartSeconds}"> sn</span></label>
    <label><input type="checkbox" data-setting="autoAdvance" ${settings.autoAdvance ? 'checked' : ''}> Sonraki bölüme otomatik geç</label>
    <label><input type="checkbox" data-setting="blockSocket" ${settings.blockSocket ? 'checked' : ''}> Sitenin WebSocket bağlantısını engelle</label>
    <label><input type="checkbox" data-setting="focusMode" ${settings.focusMode ? 'checked' : ''}> Odak modu (site arayüzünü gizle)</label>
    <p>Klavye: ← / → ${SEEK_STEP_SECONDS} sn geri / ileri</p>`;
  document.body.append(drawer);
  keepNativeScroll(drawer);
  drawer.querySelector('[data-action="close-settings"]').addEventListener('click', () => { drawer.hidden = true; });
  drawer.querySelectorAll('[data-setting]').forEach((control) => control.addEventListener('change', async () => {
    const key = control.dataset.setting;
    settings[key] = control.type === 'checkbox' ? control.checked : Math.max(0, Number(control.value) || 0);
    await saveSettings();
    if (key === 'focusMode') render(true);
    // An already open socket stays open; reload once the background rule is in place.
    if (key === 'blockSocket') {
      await chrome.runtime.sendMessage({ type: 'ANIMPOW_SYNC_SOCKET_RULES', settings });
      location.reload();
    }
  }));
  return drawer;
}

// The site's smooth-scroll provider (Lenis) takes wheel events at the window and would scroll the page
// instead of our lists; data-lenis-prevent is its opt-out, stopping propagation covers other handlers.
function keepNativeScroll(element) {
  element.setAttribute('data-lenis-prevent', '');
  element.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  element.addEventListener('touchmove', (event) => event.stopPropagation(), { passive: true });
}

function renderToggle(label, onClick) {
  document.getElementById(TOGGLE_ID)?.remove();
  const button = document.createElement('button');
  button.id = TOGGLE_ID;
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  document.body.append(button);
}

function removeUi() {
  for (const id of [PANEL_ID, TOGGLE_ID, SETTINGS_ID]) document.getElementById(id)?.remove();
  document.documentElement.classList.remove('apw-focus', 'apw-panel-open');
}

function render(force = false) {
  const context = getContext();
  if (!context) {
    removeUi();
    renderedPath = null;
    return;
  }
  const video = findEpisodeVideo();
  // Stay out of the page until its player exists, so nothing is injected while React is still booting.
  if (!video && !document.getElementById(PANEL_ID) && !document.getElementById(TOGGLE_ID)) return;
  if (video) bindVideo(video);
  const grew = updateMaxEpisode(context);
  const uiPresent = document.getElementById(PANEL_ID) || document.getElementById(TOGGLE_ID);
  if (!force && !grew && renderedPath === location.pathname && uiPresent) {
    if (settings.focusMode && video && !document.querySelector('[data-apw="player"]')) applyFocusLayout(video);
    return;
  }
  renderedPath = location.pathname;
  const scroller = document.querySelector(`#${PANEL_ID} .apw-arcs`);
  const previousScroll = force ? scroller?.scrollTop : null;
  removeUi();

  if (!settings.focusMode) {
    renderToggle('◧ Odak modunu aç', async () => {
      settings.focusMode = true;
      await saveSettings();
      render(true);
    });
    return;
  }
  document.documentElement.classList.add('apw-focus');
  if (video) applyFocusLayout(video);

  if (!settings.panelOpen) {
    renderToggle('≡ Arc Master', async () => {
      settings.panelOpen = true;
      await saveSettings();
      render(true);
    });
    return;
  }
  document.documentElement.classList.add('apw-panel-open');

  const arcs = core.groupEpisodes({ coreId: context.coreId, maxEpisode: maxEpisodeSeen });
  const currentArc = arcs.find((arc) => context.episode >= arc.from && context.episode <= arc.to);
  const type = core.episodeType(context.coreId, context.episode);
  const latest = progressRecords
    .filter((record) => record.coreId === context.coreId && record.state === 'in-progress')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const rate = Number(settings.playbackRate) || 1;

  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <header class="apw-header">
      <div><strong>ARC MASTER</strong><span>${latest ? `Kaldığın yer: ${latest.episodeNumber}. Bölüm · ${formatTime(latest.positionSeconds)}` : 'İzleme geçmişin burada görünür'}</span></div>
      <span><button type="button" data-action="settings" aria-label="Ayarlar">⚙</button><button type="button" data-action="collapse" aria-label="Paneli kapat">×</button></span>
    </header>
    <div class="apw-now">
      <strong>${currentArc ? `${arcLabel(currentArc)} · ` : ''}${context.episode}. Bölüm</strong>
      ${type ? `<span class="apw-badge apw-type-${type}">${TYPE_LABELS[type]}</span>` : ''}
    </div>
    <div class="apw-controls">
      <button type="button" data-action="seek-back">⏪ ${SEEK_STEP_SECONDS} sn</button>
      <button type="button" data-action="seek-forward">${SEEK_STEP_SECONDS} sn ⏩</button>
    </div>
    <div class="apw-speed">${[1, 1.25, 1.5, 2].map((value) => `<button type="button" data-rate="${value}" class="${value === rate ? 'selected' : ''}">${value}×</button>`).join('')}</div>
    <nav class="apw-nav">
      ${context.episode > 1 ? `<a href="${episodeLink(context, context.episode - 1)}">← ${context.episode - 1}</a>` : '<span></span>'}
      ${context.episode < maxEpisodeSeen ? `<a href="${episodeLink(context, context.episode + 1)}">${context.episode + 1} →</a>` : '<span></span>'}
    </nav>
    ${latest && latest.episodeNumber !== context.episode ? `<a class="apw-resume" href="${episodeLink(context, latest.episodeNumber)}">▶ Kaldığın yere dön</a>` : ''}
    ${type ? `<div class="apw-legend"><span class="apw-type-mixed">Karışık</span><span class="apw-type-filler">Filler</span><span class="apw-type-anime-canon">Anime canon</span></div>` : ''}
    <div class="apw-arcs">${renderArcs(context, arcs)}</div>`;
  document.body.append(panel);
  keepNativeScroll(panel);
  const drawer = renderSettings();

  panel.querySelector('[data-action="settings"]').addEventListener('click', () => { drawer.hidden = !drawer.hidden; });
  panel.querySelector('[data-action="collapse"]').addEventListener('click', async () => {
    settings.panelOpen = false;
    await saveSettings();
    render(true);
  });
  panel.querySelector('[data-action="seek-back"]').addEventListener('click', () => seekBy(-SEEK_STEP_SECONDS));
  panel.querySelector('[data-action="seek-forward"]').addEventListener('click', () => seekBy(SEEK_STEP_SECONDS));
  panel.querySelectorAll('[data-rate]').forEach((button) => button.addEventListener('click', () => setPlaybackRate(Number(button.dataset.rate))));
  panel.querySelector('[data-action="complete-current"]')?.addEventListener('click', () => markCompleted(context, [context.episode]));
  panel.querySelector('[data-action="complete-through"]')?.addEventListener('click', () => {
    const numbers = arcs.flatMap((arc) => arc.episodes).filter((number) => number <= context.episode);
    markCompleted(context, numbers);
  });
  panel.querySelector('[data-action="reset-current"]')?.addEventListener('click', () => {
    progressRecords = progressRecords.filter((record) => record.episodeKey !== `${context.coreId}:${context.episode}`);
    startAppliedFor = null;
    saveRecords();
    render(true);
  });
  // Episode grids are built only for the open arc; other arcs fill in when opened.
  panel.querySelectorAll('.apw-arc').forEach((details) => details.addEventListener('toggle', () => {
    if (!details.open || details.querySelector('.apw-grid')) return;
    const arc = arcs.find((item) => item.key === details.dataset.arcKey);
    details.insertAdjacentHTML('beforeend', episodeGrid(context, arc));
  }));

  const arcScroller = panel.querySelector('.apw-arcs');
  requestAnimationFrame(() => {
    if (previousScroll != null) {
      arcScroller.scrollTop = previousScroll;
      return;
    }
    panel.querySelector('.apw-episode.active')?.scrollIntoView({ block: 'center' });
  });
}

document.addEventListener('keydown', (event) => {
  if (!getContext() || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const video = findEpisodeVideo();
  if (!video || !core.isEpisodeVideo(video.duration)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  seekBy(event.key === 'ArrowLeft' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS);
}, true);

new MutationObserver(() => {
  if (!initialized) return;
  if (renderedPath !== location.pathname) {
    startAppliedFor = null;
    completionSentFor = null;
    nextPromptDismissedFor = null;
    removeNextPrompt();
    clearTimeout(autoAdvanceTimer);
    render(true);
    return;
  }
  render();
}).observe(document.documentElement, { childList: true, subtree: true });

async function initialize() {
  const [storedProgress, storedSettings, storedMax] = await Promise.all([
    getStorage('local', PROGRESS_KEY),
    getStorage('sync', SETTINGS_KEY),
    getStorage('local', MAX_EPISODE_KEY)
  ]);
  progressRecords = storedProgress || [];
  settings = { ...DEFAULT_SETTINGS, ...storedSettings };
  maxEpisodeSeen = Number(storedMax) || 0;
  initialized = true;
  render(true);
}

initialize();
