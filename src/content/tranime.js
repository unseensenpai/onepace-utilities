// TRanimeizle: a Nuxt app that mounts the chosen source inside [data-watch-player]. Its own players
// (a JW Player, or an <hlsjs-video> whose <video> sits in a shadow root) are same-origin and driven
// here directly; other sources are cross-origin iframes driven through player-frame.js (via the
// background). Panel, settings and focus markers reuse the AnimPow ids and animpow.css.
const core = globalThis.TranimeCore;
const arcsCore = globalThis.AnimPowCore;
const PANEL_ID = 'apw-panel';
const TOGGLE_ID = 'apw-toggle';
const SETTINGS_ID = 'apw-settings';
const NEXT_PROMPT_ID = 'apw-next';
const PLAYER_SELECTOR = '[data-watch-player]';
const SOURCE_BUTTON_SELECTOR = 'button[aria-label$="oynatıcısına geç"]';
const FANSUB_BUTTON_SELECTOR = 'button[aria-label$="çeviri grubuna geç"]';
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
const titles = globalThis.OnePieceTitles;
const TITLE_LANGUAGE = titles.preferredLanguage(navigator.language);

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
let localVideo = null;
// Video -> the source its start position was applied to: switching fansub keeps the <video> and
// swaps its source, which needs the start position again.
const startApplied = new WeakMap();
const sourceOf = (video) => video.currentSrc || video.src;

const context = core.parseEpisodePath(location.pathname);
const initialPath = location.pathname;
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

// The site lists one range of episodes at a time (the one holding this episode); the episode count
// sits next to the "Bölümler" heading.
function readEpisodeList() {
  const paths = [...document.querySelectorAll('a.ep-tile[href]')].map((anchor) => anchor.getAttribute('href'));
  episodeLinks = core.collectEpisodeLinks(context.slug, paths);
  const heading = [...document.querySelectorAll('h2')].find((element) => element.textContent.trim() === 'Bölümler');
  const total = Number(heading?.nextElementSibling?.textContent) || 0;
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

function collectVideos(root) {
  const videos = [...root.querySelectorAll('video')];
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) videos.push(...collectVideos(element.shadowRoot));
  }
  return videos;
}

// Ads may add their own short <video> next to the episode's, so a full-length one wins.
function findLocalVideo() {
  const player = document.querySelector(PLAYER_SELECTOR);
  if (!player) return null;
  const videos = collectVideos(player);
  return videos.find((video) => arcsCore.isEpisodeVideo(video.duration)) ?? videos[0] ?? null;
}

function applyLocalPreferences(video) {
  if (!arcsCore.isEpisodeVideo(video.duration)) return;
  video.playbackRate = Number(settings.playbackRate) || 1;
  if (startApplied.get(video) === sourceOf(video)) return;
  startApplied.set(video, sourceOf(video));
  const start = arcsCore.resolveStartPosition({
    record: recordFor(context.episode),
    customStartSeconds: settings.customStartSeconds,
    useResume: settings.useResume
  });
  if (start > 0 && start < video.duration - 1) video.currentTime = start;
  // The site's player waits on its poster; like the frame sources, it starts on its own (the
  // browser may refuse without a recent click, and the poster then stays).
  if (video.paused) video.play().catch(() => undefined);
}

function bindLocalVideo(video) {
  if (video.dataset.apwBound) return;
  video.dataset.apwBound = 'true';
  const apply = () => applyLocalPreferences(video);
  video.addEventListener('loadedmetadata', apply);
  video.addEventListener('durationchange', apply);
  video.addEventListener('play', apply);
  video.addEventListener('timeupdate', () => {
    // Until the start position reaches a new source, its position would overwrite the saved one.
    if (video !== localVideo || startApplied.get(video) !== sourceOf(video)) return;
    handlePosition({ positionSeconds: video.currentTime, durationSeconds: video.duration });
  });
  for (const eventType of ['ended', 'waiting', 'stalled']) {
    video.addEventListener(eventType, () => {
      if (video !== localVideo) return;
      if (!arcsCore.shouldFinishPlayback({ eventType, currentTime: video.currentTime, duration: video.duration })) return;
      handleEnded({ durationSeconds: video.duration });
    });
  }
  apply();
}

// Switching sources replaces the player, so this runs on every DOM change.
function syncLocalVideo() {
  const video = findLocalVideo();
  if (video === localVideo) return;
  localVideo = video;
  document.getElementById(NEXT_PROMPT_ID)?.remove();
  nextPromptShown = false;
  if (video) bindLocalVideo(video);
}

function seekBy(seconds) {
  if (!localVideo) {
    sendPlayerCommand('seek', { seconds });
    return;
  }
  if (!arcsCore.isEpisodeVideo(localVideo.duration)) return;
  localVideo.currentTime = Math.min(Math.max(0, localVideo.currentTime + seconds), localVideo.duration - 0.5);
}

function applyPlayerPreferences({ applyStartPosition = false } = {}) {
  if (localVideo) applyLocalPreferences(localVideo);
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

// The site's fansub and player (source) buttons, mirrored as chips in the panel; the site's own card
// under the player stays hidden with the rest of the page. A chip clicks the site's button.
const SOURCE_GROUPS = [
  { label: 'Fansub', selector: FANSUB_BUTTON_SELECTOR, suffix: / çeviri grubuna geç$/ },
  { label: 'Oynatıcı', selector: SOURCE_BUTTON_SELECTOR, suffix: / oynatıcısına geç$/ }
];

function readSourceGroups() {
  return SOURCE_GROUPS.map((group) => ({
    label: group.label,
    buttons: [...document.querySelectorAll(group.selector)].map((button) => ({
      button,
      name: button.getAttribute('aria-label').replace(group.suffix, ''),
      selected: button.classList.contains('bg-primary')
    }))
  })).filter((group) => group.buttons.length);
}

// Runs on every DOM change: the site re-renders its buttons after each pick (and the player list per
// fansub), so the chips are rebuilt only when the names or the selection change.
function renderSourceChips() {
  const container = document.querySelector(`#${PANEL_ID} .apw-sources`);
  if (!container) return;
  const groups = readSourceGroups();
  const signature = JSON.stringify(groups.map((group) => group.buttons.map(({ name, selected }) => [name, selected])));
  if (container.dataset.signature === signature) return;
  container.dataset.signature = signature;
  container.innerHTML = groups.map((group, groupIndex) => `<div><span>${group.label}</span>${group.buttons.map(({ name, selected }, index) =>
    `<button type="button" data-group="${groupIndex}" data-index="${index}" class="${selected ? 'selected' : ''}">${escapeHtml(name)}</button>`).join('')}</div>`).join('');
  container.querySelectorAll('button').forEach((chip) => chip.addEventListener('click', () => {
    readSourceGroups()[chip.dataset.group]?.buttons[chip.dataset.index]?.button.click();
  }));
}

// Keeps only the player; hides every other branch of the page, including ad blocks the site injects
// later (the observer re-runs this when the body or a kept branch gains children).
function applyFocusLayout() {
  document.querySelectorAll('[data-apw]').forEach((element) => element.removeAttribute('data-apw'));
  const player = document.querySelector(PLAYER_SELECTOR);
  if (!player) return;
  const kept = new Set();
  for (let node = player; node && node !== document.body; node = node.parentElement) kept.add(node);
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
  removeHiddenMedia();
}

// Hiding a branch does not stop what plays inside it: ad frames, ad videos and an embedded YouTube
// player start with sound on the page's first click, which then never reaches the player.
function removeHiddenMedia() {
  document.querySelectorAll('[data-apw="hidden"] :is(iframe, video, audio)').forEach((element) => element.remove());
}

// Late content (the next-airing countdown, ads) can land in the body or inside a kept branch.
function hasUnmarkedChild() {
  return [document.body, ...document.querySelectorAll('[data-apw="keep"]')].some((parent) => [...parent.children].some((child) =>
    !child.dataset.apw && !child.id?.startsWith('apw-') && child.tagName !== 'SCRIPT'));
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
  if (localVideo) {
    updateLocalNextPrompt(show);
    return;
  }
  if (show === nextPromptShown) return;
  nextPromptShown = show;
  sendPlayerCommand('next-prompt', { label: show ? `${context.episode + 1}. bölüme geç ▶` : null });
}

// Same-origin players get the prompt over their bottom-right corner (inside the fullscreen element
// when there is one), following the video's on-screen position.
function updateLocalNextPrompt(show) {
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
    prompt.querySelector('[data-action="next"]').addEventListener('click', () => goToNextEpisode(lastDurationSeconds));
    prompt.querySelector('[data-action="dismiss"]').addEventListener('click', () => {
      nextPromptDismissed = true;
      prompt.remove();
    });
    host.append(prompt);
  }
  const rect = localVideo.getBoundingClientRect();
  prompt.style.right = `${Math.max(0, window.innerWidth - rect.right) + 24}px`;
  prompt.style.bottom = `${Math.max(0, window.innerHeight - rect.bottom) + 72}px`;
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

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Episode titles are bundled for One Piece only, so other shows keep the compact number grid.
function episodeTitle(number) {
  return arcsId === arcsCore.ONE_PIECE_CORE_ID ? titles.episodeTitle(number, TITLE_LANGUAGE) : '';
}

function episodeGrid(arc) {
  const titled = Boolean(episodeTitle(arc.from));
  return `<div class="apw-grid${titled ? ' apw-titled' : ''}">${arc.episodes.map((number) => {
    const record = recordFor(number);
    const type = arcsCore.episodeType(arcsId, number);
    const title = episodeTitle(number);
    const mark = record?.state === 'completed' ? '✓ ' : record?.state === 'in-progress' ? '◐ ' : '';
    const classes = ['apw-episode', record?.state ?? 'unseen', type ? `apw-type-${type}` : '', number === context.episode ? 'active' : ''].join(' ');
    const tooltip = [title, type ? TYPE_LABELS[type] : ''].filter(Boolean).join(' · ');
    return `<a class="${classes}" href="${episodeLink(number)}" title="${escapeHtml(tooltip)}"><strong>${mark}${number}</strong>${title ? `<span>${escapeHtml(title)}</span>` : ''}</a>`;
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
    <p>Klavye: ← / → ${SEEK_STEP_SECONDS} sn geri / ileri</p>
    <section class="apw-backup"><strong>Yedekleme (tüm siteler)</strong><div><button type="button" data-action="export-setup">Tüm ilerleme ve ayarları dışa aktar</button><button type="button" data-action="import-setup">Tüm ilerleme ve ayarları içe aktar</button><input type="file" accept="application/json,.json" data-input="setup" hidden></div></section>`;
  document.body.append(drawer);
  keepNativeScroll(drawer);
  drawer.querySelector('[data-action="close-settings"]').addEventListener('click', () => { drawer.hidden = true; });
  globalThis.OnePaceBackup.bindSetupControls(drawer);
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
    ${episodeTitle(context.episode) ? `<p class="apw-now-title">${escapeHtml(episodeTitle(context.episode))}</p>` : ''}
    <div class="apw-controls">
      <button type="button" data-action="seek-back">⏪ ${SEEK_STEP_SECONDS} sn</button>
      <button type="button" data-action="seek-forward">${SEEK_STEP_SECONDS} sn ⏩</button>
    </div>
    <div class="apw-speed">${[1, 1.25, 1.5, 2].map((value) => `<button type="button" data-rate="${value}" class="${value === rate ? 'selected' : ''}">${value}×</button>`).join('')}</div>
    <div class="apw-sources"></div>
    <nav class="apw-nav">
      ${context.episode > 1 ? `<a href="${episodeLink(context.episode - 1)}">← ${context.episode - 1}</a>` : '<span></span>'}
      ${context.episode < maxEpisode ? `<a href="${episodeLink(context.episode + 1)}">${context.episode + 1} →</a>` : '<span></span>'}
    </nav>
    ${latest && latest.episodeNumber !== context.episode ? `<a class="apw-resume" href="${episodeLink(latest.episodeNumber)}">▶ Kaldığın yere dön</a>` : ''}
    ${type ? `<div class="apw-legend"><span class="apw-type-mixed">Karışık</span><span class="apw-type-filler">Filler</span><span class="apw-type-anime-canon">Anime canon</span></div>` : ''}
    <div class="apw-arcs">${renderArcs(arcs)}</div>`;
  document.body.append(panel);
  keepNativeScroll(panel);
  renderSourceChips();
  const drawer = renderSettings();

  panel.querySelector('[data-action="settings"]').addEventListener('click', () => { drawer.hidden = !drawer.hidden; });
  panel.querySelector('[data-action="collapse"]').addEventListener('click', async () => {
    settings.panelOpen = false;
    await saveSettings();
    render();
  });
  panel.querySelector('[data-action="seek-back"]').addEventListener('click', () => seekBy(-SEEK_STEP_SECONDS));
  panel.querySelector('[data-action="seek-forward"]').addEventListener('click', () => seekBy(SEEK_STEP_SECONDS));
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
  // Keeps the JW Player's own 5 s arrow-key seek from adding to ours.
  event.stopImmediatePropagation();
  seekBy(event.key === 'ArrowLeft' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS);
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
  syncLocalVideo();
  // Ads also fill hidden branches later, so the whole tree is watched.
  new MutationObserver(() => {
    // The site's own links change episodes client-side; this script's state is per episode.
    if (location.pathname !== initialPath) {
      location.reload();
      return;
    }
    syncLocalVideo();
    if (!settings.focusMode) return;
    renderSourceChips();
    if (hasUnmarkedChild()) applyFocusLayout();
    else removeHiddenMedia();
  }).observe(document.body, { childList: true, subtree: true });
}

if (context) initialize();
