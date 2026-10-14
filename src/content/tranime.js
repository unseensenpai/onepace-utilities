// TRanimeizle: the page is server-rendered and plays each source in a cross-origin iframe, so the
// player is driven through player-frame.js (via the background) instead of touching a <video> here.
// Panel, settings and focus markers reuse the AnimPow ids and animpow.css.
const core = globalThis.TranimeCore;
const arcsCore = globalThis.AnimPowCore;
const PANEL_ID = 'apw-panel';
const TOGGLE_ID = 'apw-toggle';
const SETTINGS_ID = 'apw-settings';
const PROGRESS_KEY = 'tranimeProgress';
const SETTINGS_KEY = 'tranimeSettings';
const SEEK_STEP_SECONDS = 15;
const DEFAULT_SETTINGS = {
  focusMode: true,
  panelOpen: true,
  playbackRate: 1,
  customStartSeconds: 0,
  useResume: true,
  autoAdvance: true
};
const TYPE_LABELS = { canon: 'Canon', mixed: 'Karışık', filler: 'Filler', 'anime-canon': 'Anime canon' };

let settings = { ...DEFAULT_SETTINGS };
let progressRecords = [];
let initialized = false;
let completionSent = false;
let nextPromptShown = false;
let nextPromptDismissed = false;
let lastPositionSave = 0;
let lastDurationSeconds = 0;
let autoAdvanceTimer = null;
let episodeLinks = {};
let maxEpisode = 0;

const context = core.parseEpisodePath(location.pathname);
// Records are keyed per site so they never mix with AnimPow's; arcs and episode types use One Piece data.
const recordId = context ? `tranime:${context.slug}` : null;
const arcsId = context?.slug === 'one-piece' ? arcsCore.ONE_PIECE_CORE_ID : context?.slug;

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

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function readEpisodeList() {
  const paths = [...document.querySelectorAll('.animeDetail-items a[href]')].map((anchor) => anchor.getAttribute('href'));
  episodeLinks = core.collectEpisodeLinks(context.slug, paths);
  const total = Number(document.querySelector('.animeDetail-desc span')?.textContent) || 0;
  maxEpisode = Math.max(context.episode, total, ...Object.keys(episodeLinks).map(Number));
}

function episodeLink(number) {
  return core.episodeLink(episodeLinks, context.slug, number);
}

function sendRuntime(message) {
  chrome.runtime.sendMessage(message).catch?.(() => undefined);
}

function sendPlayerCommand(command, detail = {}) {
  sendRuntime({ type: 'ONEPACE_PLAYER_COMMAND', command, ...detail });
}

function applyPlayerPreferences({ applyStartPosition = false } = {}) {
  const payload = { playbackRate: Number(settings.playbackRate) || 1 };
  if (applyStartPosition) {
    payload.autoplay = true;
    payload.startAtSeconds = arcsCore.resolveStartPosition({
      record: recordFor(context.episode),
      customStartSeconds: settings.customStartSeconds,
      useResume: settings.useResume
    });
  }
  sendRuntime({ type: 'ONEPACE_APPLY_PLAYER_PREFERENCES', payload });
}

// Keeps the player, the fansub selector and the source list; hides every other branch of the page,
// including ad blocks the site injects later (the observer re-runs this when the body gains children).
function applyFocusLayout() {
  document.querySelectorAll('[data-apw]').forEach((element) => element.removeAttribute('data-apw'));
  const player = document.getElementById('videoPlayer');
  if (!player) return;
  // The fansub row only matters when there is more than one fansub to pick from.
  const fansubRow = document.querySelectorAll('.fansubSelector').length > 1
    ? document.querySelector('.fansubSelector').closest('.playlist-title')
    : null;
  const sources = [fansubRow, document.querySelector('.videoSource-playlist')].filter(Boolean);
  const kept = new Set();
  for (const target of [player, ...sources]) {
    for (let node = target; node && node !== document.body; node = node.parentElement) kept.add(node);
  }
  for (const node of kept) {
    for (const sibling of node.parentElement.children) {
      if (kept.has(sibling) || sibling.id?.startsWith('apw-') || sibling.tagName === 'SCRIPT') continue;
      sibling.dataset.apw = 'hidden';
    }
    node.dataset.apw = 'keep';
  }
  for (const sibling of document.body.children) {
    if (!kept.has(sibling) && !sibling.id?.startsWith('apw-') && sibling.tagName !== 'SCRIPT') sibling.dataset.apw = 'hidden';
  }
  player.dataset.apw = 'player';
  sources.forEach((element) => { element.dataset.apw = 'source'; });
}

// Episodes open on the site's "pick a source" placeholder. The site binds its source click handler
// after our script may run and re-renders the list per fansub, so the first source is clicked every
// half second until the site marks it selected (giving up after 15 s, or once another source is
// picked by hand).
// The site's first click on an episode each day loads its pre-video screen (/api/preVideoAd) and
// records preVideo_<episode id> in localStorage; only the next click loads the player, so when
// that record changes after our click, the source is clicked once more.
const SOURCE_PICK_TIMEOUT = 15000;
const preVideoWatched = new WeakSet();

function watchPreVideo(button) {
  if (preVideoWatched.has(button)) return;
  preVideoWatched.add(button);
  const key = `preVideo_${button.dataset.eid}`;
  const before = localStorage.getItem(key);
  const player = document.getElementById('videoPlayer');
  if (!player) return;
  const watcher = new MutationObserver(() => {
    if (localStorage.getItem(key) === before) return;
    watcher.disconnect();
    console.info('[Arc Master] Ön video ekranı geçildi, kaynak yeniden açılıyor.');
    setTimeout(() => button.click(), 300);
  });
  watcher.observe(player, { childList: true });
  setTimeout(() => watcher.disconnect(), SOURCE_PICK_TIMEOUT);
}

function startSourceAutoPick() {
  const startedAt = Date.now();
  const initial = document.querySelector('#sourceList .sourceBtn.selected');
  // A source the server already marked selected with a player in place is left alone.
  if (initial && document.querySelector('#videoPlayer iframe')) return;
  const timer = setInterval(() => {
    const first = document.querySelector('#sourceList .sourceBtn');
    const selected = document.querySelector('#sourceList .sourceBtn.selected');
    if (Date.now() - startedAt > SOURCE_PICK_TIMEOUT || (selected && selected !== first)) {
      clearInterval(timer);
      return;
    }
    if (!first) return;
    if (first.classList.contains('selected')) {
      clearInterval(timer);
      return;
    }
    console.info('[Arc Master] İlk kaynak seçiliyor:', first.textContent.trim().split(/\s+/)[0]);
    watchPreVideo(first);
    first.click();
  }, 500);
}

function hasUnmarkedBodyChild() {
  return [...document.body.children].some((child) =>
    !child.dataset.apw && !child.id?.startsWith('apw-') && child.tagName !== 'SCRIPT');
}

function recordFor(episodeNumber) {
  return arcsCore.findRecord(progressRecords, recordId, episodeNumber);
}

function saveProgress(positionSeconds, durationSeconds, completed = false) {
  progressRecords = arcsCore.upsertProgress(progressRecords, {
    coreId: recordId,
    episodeNumber: context.episode,
    positionSeconds: Math.floor(positionSeconds),
    durationSeconds: Math.floor(durationSeconds),
    completed,
    updatedAt: new Date().toISOString()
  });
  saveRecords();
}

function markCompleted(episodeNumbers) {
  progressRecords = arcsCore.markCompleted(progressRecords, recordId, episodeNumbers, new Date().toISOString());
  saveRecords();
  render();
}

function setNextPrompt(show) {
  if (show === nextPromptShown) return;
  nextPromptShown = show;
  sendPlayerCommand('next-prompt', { label: show ? `${context.episode + 1}. bölüme geç ▶` : null });
}

function goToNextEpisode(durationSeconds) {
  clearTimeout(autoAdvanceTimer);
  completionSent = true;
  saveProgress(durationSeconds, durationSeconds, true);
  location.href = episodeLink(context.episode + 1);
}

function handlePosition({ positionSeconds, durationSeconds }) {
  // Pre-roll ads inside the player frame are short videos; only a full episode counts.
  if (!arcsCore.isEpisodeVideo(durationSeconds)) return;
  lastDurationSeconds = durationSeconds;
  setNextPrompt(context.episode < maxEpisode && !completionSent && !nextPromptDismissed
    && arcsCore.isNearEnd({ currentTime: positionSeconds, duration: durationSeconds }));
  const now = Date.now();
  if (now - lastPositionSave < 5000) return;
  lastPositionSave = now;
  saveProgress(positionSeconds, durationSeconds);
}

function handleEnded({ durationSeconds }) {
  if (completionSent || !arcsCore.isEpisodeVideo(durationSeconds)) return;
  completionSent = true;
  setNextPrompt(false);
  saveProgress(durationSeconds, durationSeconds, true);
  render();
  if (settings.autoAdvance && context.episode < maxEpisode) beginAutoAdvance();
}

function setPlaybackRate(rate) {
  settings.playbackRate = rate;
  saveSettings();
  applyPlayerPreferences();
  render();
}

function beginAutoAdvance() {
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
    location.href = episodeLink(next);
  }, 5000);
}

function arcLabel(arc) {
  return arc.name ?? `Bölüm ${arc.from}–${arc.to}`;
}

function episodeGrid(arc) {
  return `<div class="apw-grid">${arc.episodes.map((number) => {
    const record = recordFor(number);
    const type = arcsCore.episodeType(arcsId, number);
    const mark = record?.state === 'completed' ? '✓ ' : record?.state === 'in-progress' ? '◐ ' : '';
    const classes = ['apw-episode', record?.state ?? 'unseen', type ? `apw-type-${type}` : '', number === context.episode ? 'active' : ''].join(' ');
    return `<a class="${classes}" href="${episodeLink(number)}" title="${type ? TYPE_LABELS[type] : ''}"><strong>${mark}${number}</strong></a>`;
  }).join('')}</div>`;
}

function renderArcs(arcs) {
  return arcs.map((arc) => {
    const active = context.episode >= arc.from && context.episode <= arc.to;
    const completed = arc.episodes.filter((number) => recordFor(number)?.state === 'completed').length;
    const state = completed === arc.episodes.length ? 'completed' : active ? 'active' : 'untouched';
    const actions = active ? `<div class="apw-arc-actions">
        <button type="button" data-action="complete-current">✓ Bu bölümü izlendi işaretle</button>
        <button type="button" data-action="complete-through">✓ Buraya kadar izlendi</button>
        <button type="button" data-action="reset-current">↺ İlerlemeyi sıfırla</button>
      </div>` : '';
    const grid = active ? episodeGrid(arc) : '';
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
    <label><input type="checkbox" data-setting="focusMode" ${settings.focusMode ? 'checked' : ''}> Odak modu (site arayüzünü gizle)</label>
    <p>Klavye: ← / → ${SEEK_STEP_SECONDS} sn geri / ileri</p>`;
  document.body.append(drawer);
  keepNativeScroll(drawer);
  drawer.querySelector('[data-action="close-settings"]').addEventListener('click', () => { drawer.hidden = true; });
  drawer.querySelectorAll('[data-setting]').forEach((control) => control.addEventListener('change', async () => {
    const key = control.dataset.setting;
    settings[key] = control.type === 'checkbox' ? control.checked : Math.max(0, Number(control.value) || 0);
    await saveSettings();
    if (key === 'focusMode') render();
  }));
  return drawer;
}

function keepNativeScroll(element) {
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
  document.querySelectorAll('[data-apw]').forEach((element) => element.removeAttribute('data-apw'));
}

function render() {
  const scroller = document.querySelector(`#${PANEL_ID} .apw-arcs`);
  const previousScroll = scroller?.scrollTop ?? null;
  removeUi();

  if (!settings.focusMode) {
    renderToggle('◧ Odak modunu aç', async () => {
      settings.focusMode = true;
      await saveSettings();
      render();
    });
    return;
  }
  document.documentElement.classList.add('apw-focus');
  applyFocusLayout();

  if (!settings.panelOpen) {
    renderToggle('≡ Arc Master', async () => {
      settings.panelOpen = true;
      await saveSettings();
      render();
    });
    return;
  }
  document.documentElement.classList.add('apw-panel-open');

  const arcs = arcsCore.groupEpisodes({ coreId: arcsId, maxEpisode });
  const currentArc = arcs.find((arc) => context.episode >= arc.from && context.episode <= arc.to);
  const type = arcsCore.episodeType(arcsId, context.episode);
  const latest = progressRecords
    .filter((record) => record.coreId === recordId && record.state === 'in-progress')
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
      ${context.episode > 1 ? `<a href="${episodeLink(context.episode - 1)}">← ${context.episode - 1}</a>` : '<span></span>'}
      ${context.episode < maxEpisode ? `<a href="${episodeLink(context.episode + 1)}">${context.episode + 1} →</a>` : '<span></span>'}
    </nav>
    ${latest && latest.episodeNumber !== context.episode ? `<a class="apw-resume" href="${episodeLink(latest.episodeNumber)}">▶ Kaldığın yere dön</a>` : ''}
    ${type ? `<div class="apw-legend"><span class="apw-type-mixed">Karışık</span><span class="apw-type-filler">Filler</span><span class="apw-type-anime-canon">Anime canon</span></div>` : ''}
    <div class="apw-arcs">${renderArcs(arcs)}</div>`;
  document.body.append(panel);
  keepNativeScroll(panel);
  const drawer = renderSettings();

  panel.querySelector('[data-action="settings"]').addEventListener('click', () => { drawer.hidden = !drawer.hidden; });
  panel.querySelector('[data-action="collapse"]').addEventListener('click', async () => {
    settings.panelOpen = false;
    await saveSettings();
    render();
  });
  panel.querySelector('[data-action="seek-back"]').addEventListener('click', () => sendPlayerCommand('seek', { seconds: -SEEK_STEP_SECONDS }));
  panel.querySelector('[data-action="seek-forward"]').addEventListener('click', () => sendPlayerCommand('seek', { seconds: SEEK_STEP_SECONDS }));
  panel.querySelectorAll('[data-rate]').forEach((button) => button.addEventListener('click', () => setPlaybackRate(Number(button.dataset.rate))));
  panel.querySelector('[data-action="complete-current"]')?.addEventListener('click', () => markCompleted([context.episode]));
  panel.querySelector('[data-action="complete-through"]')?.addEventListener('click', () => {
    markCompleted(arcs.flatMap((arc) => arc.episodes).filter((number) => number <= context.episode));
  });
  panel.querySelector('[data-action="reset-current"]')?.addEventListener('click', () => {
    progressRecords = progressRecords.filter((record) => record.episodeKey !== `${recordId}:${context.episode}`);
    saveRecords();
    render();
  });
  // Episode grids are built only for the open arc; other arcs fill in when opened.
  panel.querySelectorAll('.apw-arc').forEach((details) => details.addEventListener('toggle', () => {
    if (!details.open || details.querySelector('.apw-grid')) return;
    const arc = arcs.find((item) => item.key === details.dataset.arcKey);
    details.insertAdjacentHTML('beforeend', episodeGrid(arc));
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

chrome.runtime.onMessage.addListener((message) => {
  if (!initialized) return;
  // A frame announces itself on load and whenever the site swaps the source iframe.
  if (message.type === 'ONEPACE_PLAYER_READY') {
    nextPromptShown = false;
    applyPlayerPreferences({ applyStartPosition: true });
    return;
  }
  if (message.type !== 'ONEPACE_PLAYER_EVENT') return;
  if (message.event === 'position') handlePosition(message.detail);
  if (message.event === 'ended') handleEnded(message.detail);
  if (message.event === 'next-requested') goToNextEpisode(lastDurationSeconds);
  if (message.event === 'next-dismissed') {
    nextPromptDismissed = true;
    nextPromptShown = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  sendPlayerCommand('seek', { seconds: event.key === 'ArrowLeft' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS });
}, true);

async function initialize() {
  const [storedProgress, storedSettings] = await Promise.all([
    getStorage('local', PROGRESS_KEY),
    getStorage('sync', SETTINGS_KEY)
  ]);
  progressRecords = storedProgress || [];
  settings = { ...DEFAULT_SETTINGS, ...storedSettings };
  readEpisodeList();
  initialized = true;
  render();
  // The player frame may have announced itself before storage loaded.
  applyPlayerPreferences({ applyStartPosition: true });
  new MutationObserver(() => {
    if (settings.focusMode && hasUnmarkedBodyChild()) applyFocusLayout();
  }).observe(document.body, { childList: true });
  startSourceAutoPick();
}

if (context) initialize();
