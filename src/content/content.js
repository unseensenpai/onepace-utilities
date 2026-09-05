const ROOT_ID = 'onepace-utilities-root';
const SETTINGS_DRAWER_ID = 'onepace-utilities-settings';
const PROGRESS_KEY = 'onepaceProgress';
const SETTINGS_KEY = 'onepaceSettings';
const DEFAULT_SETTINGS = {
  autoAdvance: true,
  playbackRate: 1,
  customStartSeconds: 0,
  useResume: true,
  preferredSource: 'automatic'
};

let lastEpisodeNumber = null;
let progressRecords = [];
let settings = { ...DEFAULT_SETTINGS };
let lastPositionSave = 0;
let autoAdvanceTimer = null;

function getEpisodeNumber() {
  return Number(location.pathname.match(/\/bolum\/(\d+)/)?.[1] ?? 0);
}

function getStorage(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (value) => resolve(value[key])));
}

function setStorage(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function getSyncStorage(key) {
  return new Promise((resolve) => chrome.storage.sync.get(key, (value) => resolve(value[key])));
}

function setSyncStorage(value) {
  return new Promise((resolve) => chrome.storage.sync.set(value, resolve));
}

function parseGroups() {
  return [...document.querySelectorAll('.episode-list .group')].map((group, index) => {
    const name = group.querySelector('h4')?.textContent.trim() || `Arc ${index + 1}`;
    const episodes = [...group.querySelectorAll('a[href*="/bolum/"]')].map((anchor) => {
      const number = Number(anchor.getAttribute('href')?.match(/\/bolum\/(\d+)/)?.[1] ?? 0);
      return { number, name: anchor.textContent.replace(/^\s*\d+\.\s*Bölüm:\s*/i, '').trim() };
    }).filter((episode) => episode.number > 0);
    return { key: `${name}-${index}`, name, episodes };
  }).filter((arc) => arc.episodes.length);
}

function getRecord(episodeNumber) {
  return progressRecords.find((record) => record.episodeNumber === episodeNumber);
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function progressState(episodeNumber) {
  const record = getRecord(episodeNumber);
  if (!record) return 'unseen';
  return record.state;
}

function saveProgress(positionSeconds, durationSeconds, completed = false) {
  const episodeNumber = getEpisodeNumber();
  if (!episodeNumber) return;
  const index = progressRecords.findIndex((record) => record.episodeNumber === episodeNumber);
  const record = {
    episodeKey: `episode-${episodeNumber}`,
    episodeNumber,
    state: completed ? 'completed' : 'in-progress',
    positionSeconds: completed ? durationSeconds : positionSeconds,
    durationSeconds,
    updatedAt: new Date().toISOString()
  };
  progressRecords = index === -1
    ? [...progressRecords, record]
    : progressRecords.map((item, itemIndex) => itemIndex === index ? record : item);
  setStorage({ [PROGRESS_KEY]: progressRecords });
  render();
}

function getResumeStart() {
  const record = getRecord(getEpisodeNumber());
  if (settings.useResume && record?.state === 'in-progress') return record.positionSeconds;
  return settings.customStartSeconds;
}

function applyPlayerPreferences() {
  chrome.runtime.sendMessage({
    type: 'ONEPACE_APPLY_PLAYER_PREFERENCES',
    payload: { playbackRate: settings.playbackRate, startAtSeconds: getResumeStart() }
  });
  if (settings.preferredSource !== 'automatic') {
    const source = [...document.querySelectorAll('.players .player a')].find(
      (anchor) => anchor.textContent.trim().toLowerCase() === settings.preferredSource
    );
    source?.click();
  }
}

function nextEpisode(arcs) {
  const currentArc = arcs.find((arc) => arc.episodes.some((episode) => episode.number === getEpisodeNumber()));
  if (!currentArc) return null;
  const currentIndex = currentArc.episodes.findIndex((episode) => episode.number === getEpisodeNumber());
  return currentArc.episodes[currentIndex + 1] ?? null;
}

function beginAutoAdvance(next) {
  clearTimeout(autoAdvanceTimer);
  const panel = document.getElementById(ROOT_ID);
  if (!panel) return;
  let remaining = 5;
  const notice = document.createElement('div');
  notice.className = 'opu-countdown';
  notice.innerHTML = `<span>Sonraki bölüm ${remaining} sn içinde açılacak</span><button>İptal</button>`;
  panel.prepend(notice);
  const interval = setInterval(() => {
    remaining -= 1;
    const label = notice.querySelector('span');
    if (label) label.textContent = `Sonraki bölüm ${remaining} sn içinde açılacak`;
  }, 1000);
  notice.querySelector('button').addEventListener('click', () => {
    clearInterval(interval);
    clearTimeout(autoAdvanceTimer);
    notice.remove();
  });
  autoAdvanceTimer = setTimeout(() => {
    clearInterval(interval);
    location.href = `/bolum/${next.number}`;
  }, 5000);
}

function render() {
  const nativeList = document.querySelector('.episode-list');
  if (!nativeList) return;
  const arcs = parseGroups();
  const currentEpisode = getEpisodeNumber();
  const currentArc = arcs.find((arc) => arc.episodes.some((episode) => episode.number === currentEpisode));
  const currentCard = currentArc?.episodes.find((episode) => episode.number === currentEpisode);
  const sourceOptions = [...document.querySelectorAll('.players .player a')]
    .map((anchor) => anchor.textContent.trim().toLowerCase())
    .filter(Boolean);
  const existing = document.getElementById(ROOT_ID);
  const existingRail = document.getElementById('onepace-utilities-context');
  const existingDrawer = document.getElementById(SETTINGS_DRAWER_ID);
  if (existing) existing.remove();
  if (existingRail) existingRail.remove();
  if (existingDrawer) existingDrawer.remove();
  nativeList.style.display = 'none';
  document.documentElement.classList.add('opu-focus-mode');

  const root = document.createElement('section');
  root.id = ROOT_ID;
  root.className = 'opu-panel';
  const latest = progressRecords
    .filter((record) => record.state === 'in-progress')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const arcMarkup = arcs.map((arc) => {
    const completed = arc.episodes.filter((episode) => progressState(episode.number) === 'completed').length;
    const active = arc.episodes.some((episode) => episode.number === currentEpisode);
    return `<details class="opu-arc" ${active ? 'open' : ''}>
      <summary><span>${arc.name}</span><small>${completed} / ${arc.episodes.length} tamamlandı</small></summary>
      <div class="opu-grid">${arc.episodes.map((episode) => {
        const state = progressState(episode.number);
        const record = getRecord(episode.number);
        return `<a class="opu-episode ${state} ${episode.number === currentEpisode ? 'active' : ''}" href="/bolum/${episode.number}" title="${episode.name}">
          <strong>${state === 'completed' ? '✓ ' : state === 'in-progress' ? '◐ ' : ''}${episode.number}</strong>
          <small>${record?.state === 'in-progress' ? formatTime(record.positionSeconds) : episode.name}</small>
        </a>`;
      }).join('')}</div>
    </details>`;
  }).join('');

  root.innerHTML = `<header class="opu-header">
    <div><strong>ARC MASTER</strong><span>${latest ? `Kaldığın yer: ${latest.episodeNumber}. Bölüm · ${formatTime(latest.positionSeconds)}` : 'İzleme geçmişin burada görünür'}</span></div>
    <button class="opu-settings-toggle" aria-label="Oynatıcı ayarları">⚙</button>
  </header>
  ${latest ? `<a class="opu-resume" href="/bolum/${latest.episodeNumber}">▶ Kaldığın yere dön</a>` : ''}
  <div class="opu-arcs">${arcMarkup || '<p class="opu-empty">Bölüm listesi yükleniyor…</p>'}</div>`;
  nativeList.parentElement.insertBefore(root, nativeList);

  const drawer = document.createElement('aside');
  drawer.id = SETTINGS_DRAWER_ID;
  drawer.className = 'opu-settings';
  drawer.hidden = true;
  drawer.innerHTML = `
    <label><input type="checkbox" data-setting="useResume" ${settings.useResume ? 'checked' : ''}> Kaldığın yerden devam et</label>
    <label>Yeni bölüm başlangıcı <input type="number" min="0" data-setting="customStartSeconds" value="${settings.customStartSeconds}"> sn</label>
    <label>Hız <select data-setting="playbackRate">${[1, 1.25, 1.5, 2].map((rate) => `<option value="${rate}" ${settings.playbackRate === rate ? 'selected' : ''}>${rate}×</option>`).join('')}</select></label>
    <label>Kaynak <select data-setting="preferredSource"><option value="automatic">Otomatik</option>${sourceOptions.map((source) => `<option value="${source}" ${settings.preferredSource === source ? 'selected' : ''}>${source}</option>`).join('')}</select></label>
    <label><input type="checkbox" data-setting="autoAdvance" ${settings.autoAdvance ? 'checked' : ''}> Sonraki bölüme otomatik geç</label>
    <button data-action="complete">Bu bölümü tamamlandı yap</button>
    <button data-action="reset">Bu bölümün ilerlemesini sıfırla</button>
  `;
  document.body.append(drawer);

  root.querySelector('.opu-settings-toggle').addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
  });
  drawer.querySelectorAll('[data-setting]').forEach((control) => control.addEventListener('change', async () => {
    const key = control.dataset.setting;
    settings[key] = control.type === 'checkbox' ? control.checked : key === 'preferredSource' ? control.value : Number(control.value);
    await setSyncStorage({ [SETTINGS_KEY]: settings });
    applyPlayerPreferences();
  }));
  drawer.querySelector('[data-action="complete"]').addEventListener('click', () => saveProgress(0, getRecord(currentEpisode)?.durationSeconds || 0, true));
  drawer.querySelector('[data-action="reset"]').addEventListener('click', () => {
    progressRecords = progressRecords.filter((record) => record.episodeNumber !== currentEpisode);
    setStorage({ [PROGRESS_KEY]: progressRecords });
    render();
  });

  window.__onepaceUtilitiesArcs = arcs;
  applyPlayerPreferences();
}

async function initialize() {
  progressRecords = await getStorage(PROGRESS_KEY) || [];
  settings = { ...DEFAULT_SETTINGS, ...await getSyncStorage(SETTINGS_KEY) };
  lastEpisodeNumber = getEpisodeNumber();
  render();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'ONEPACE_PLAYER_EVENT') return;
  if (message.event === 'position') {
    const now = Date.now();
    if (now - lastPositionSave > 5000) {
      lastPositionSave = now;
      saveProgress(message.detail.positionSeconds, message.detail.durationSeconds);
    }
  }
  if (message.event === 'ended') {
    saveProgress(message.detail.durationSeconds, message.detail.durationSeconds, true);
    const next = nextEpisode(window.__onepaceUtilitiesArcs || []);
    if (settings.autoAdvance && next) beginAutoAdvance(next);
  }
});

new MutationObserver(() => {
  const current = getEpisodeNumber();
  if (current !== lastEpisodeNumber || (!document.getElementById(ROOT_ID) && document.querySelector('.episode-list'))) {
    lastEpisodeNumber = current;
    render();
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) applyPlayerPreferences();
});

initialize();
