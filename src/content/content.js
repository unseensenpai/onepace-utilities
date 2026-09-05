const ROOT_ID = 'onepace-utilities-root';
const SETTINGS_DRAWER_ID = 'onepace-utilities-settings';
const CONTROL_DOCK_ID = 'onepace-utilities-control-dock';
const PROGRESS_KEY = 'onepaceProgress';
const SETTINGS_KEY = 'onepaceSettings';
const DEFAULT_SETTINGS = {
  autoAdvance: true,
  playbackRate: 1,
  customStartSeconds: 0,
  useResume: true,
  preferredSource: 'automatic',
  language: 'tr',
  arcMasterOpen: true
};

let lastEpisodeNumber = null;
let progressRecords = [];
let settings = { ...DEFAULT_SETTINGS };
let lastPositionSave = 0;
let autoAdvanceTimer = null;

const TRANSLATIONS = {
  tr: { arcMaster: 'ARC MASTER', settings: 'Ayarlar', resumeAt: 'Kaldığın yer', history: 'İzleme geçmişin burada görünür', resume: 'Kaldığın yere dön', completed: 'tamamlandı', loading: 'Bölüm listesi yükleniyor…', resumePosition: 'Kaldığın yerden devam et', newStart: 'Yeni bölüm başlangıcı', speed: 'Hız', source: 'Kaynak', autoAdvance: 'Sonraki bölüme otomatik geç', markCompleted: 'Bu bölümü tamamlandı yap', markArcCompleted: 'Arc’ın tamamını izlendi yap', reset: 'Bu bölümün ilerlemesini sıfırla', language: 'Dil', openArc: 'Arc Master aç', closeArc: 'Arc Master kapat', nextIn: 'Sonraki bölüm', cancel: 'İptal' },
  en: { arcMaster: 'ARC MASTER', settings: 'Settings', resumeAt: 'Resume point', history: 'Your watch history appears here', resume: 'Resume watching', completed: 'completed', loading: 'Loading episode list…', resumePosition: 'Resume from saved position', newStart: 'New episode start', speed: 'Speed', source: 'Source', autoAdvance: 'Automatically play next episode', markCompleted: 'Mark episode complete', markArcCompleted: 'Mark whole arc complete', reset: 'Reset episode progress', language: 'Language', openArc: 'Open Arc Master', closeArc: 'Close Arc Master', nextIn: 'Next episode in', cancel: 'Cancel' },
  es: { arcMaster: 'MAESTRO DE ARCOS', settings: 'Ajustes', resumeAt: 'Punto de reanudación', history: 'Tu historial aparece aquí', resume: 'Reanudar reproducción', completed: 'completados', loading: 'Cargando episodios…', resumePosition: 'Reanudar desde el punto guardado', newStart: 'Inicio del episodio nuevo', speed: 'Velocidad', source: 'Fuente', autoAdvance: 'Reproducir el siguiente episodio automáticamente', markCompleted: 'Marcar episodio como completado', markArcCompleted: 'Marcar arco completo', reset: 'Restablecer progreso', language: 'Idioma', openArc: 'Abrir Maestro de Arcos', closeArc: 'Cerrar Maestro de Arcos', nextIn: 'Siguiente episodio en', cancel: 'Cancelar' }
};

function t(key) {
  return TRANSLATIONS[settings.language]?.[key] ?? TRANSLATIONS.tr[key] ?? key;
}

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

function getArcProgressState({ completed, total, isCurrent }) {
  if (total > 0 && completed === total) return 'completed';
  if (isCurrent) return 'active';
  return 'untouched';
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

function markArcCompleted(arc) {
  const episodeNumbers = new Set(arc.episodes.map((episode) => episode.number));
  const recordsByNumber = new Map(progressRecords.map((record) => [record.episodeNumber, record]));
  progressRecords = [
    ...progressRecords.filter((record) => !episodeNumbers.has(record.episodeNumber)),
    ...arc.episodes.map((episode) => {
      const existing = recordsByNumber.get(episode.number);
      const durationSeconds = existing?.durationSeconds ?? 0;
      return {
        episodeKey: existing?.episodeKey ?? `episode-${episode.number}`,
        episodeNumber: episode.number,
        state: 'completed',
        positionSeconds: durationSeconds,
        durationSeconds,
        updatedAt: new Date().toISOString()
      };
    })
  ];
  setStorage({ [PROGRESS_KEY]: progressRecords });
  render();
}

function getResumeStart() {
  const record = getRecord(getEpisodeNumber());
  if (settings.useResume && record?.state === 'in-progress') return record.positionSeconds;
  return settings.customStartSeconds;
}

function applyPlayerPreferences() {
  if (typeof chrome?.runtime?.sendMessage !== 'function') return;
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

function getAdjacentEpisodes(arcs) {
  const episodes = arcs.flatMap((arc) => arc.episodes);
  const currentIndex = episodes.findIndex((episode) => episode.number === getEpisodeNumber());
  return {
    previous: episodes[currentIndex - 1] ?? null,
    next: episodes[currentIndex + 1] ?? null
  };
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
  notice.innerHTML = `<span>${t('nextIn')} ${remaining} sn</span><button>${t('cancel')}</button>`;
  panel.prepend(notice);
  const interval = setInterval(() => {
    remaining -= 1;
    const label = notice.querySelector('span');
    if (label) label.textContent = `${t('nextIn')} ${remaining} sn`;
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
  const existingArcToggle = document.getElementById('onepace-utilities-arc-toggle');
  if (existing) existing.remove();
  if (existingRail) existingRail.remove();
  if (existingDrawer) existingDrawer.remove();
  if (existingArcToggle) existingArcToggle.remove();
  nativeList.style.display = 'none';
  document.documentElement.classList.add('opu-focus-mode');
  document.querySelector('.sidebar')?.style.setProperty('display', 'none', 'important');
  const sideColumn = nativeList.closest('.col-lg-4');
  sideColumn?.classList.toggle('opu-arc-hidden', !settings.arcMasterOpen);
  document.documentElement.classList.toggle('opu-arc-master-hidden', !settings.arcMasterOpen);
  const sourceBar = document.querySelector('.players');
  const activePlayer = document.querySelector('.active-player');
  if (sourceBar && activePlayer && sourceBar.parentElement === activePlayer.parentElement) {
    sourceBar.classList.add('opu-source-dock');
    activePlayer.parentElement.append(sourceBar);
  }

  const root = document.createElement('section');
  root.id = ROOT_ID;
  root.className = 'opu-panel';
  const latest = progressRecords
    .filter((record) => record.state === 'in-progress')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const arcMarkup = arcs.map((arc) => {
    const completed = arc.episodes.filter((episode) => progressState(episode.number) === 'completed').length;
    const active = arc.episodes.some((episode) => episode.number === currentEpisode);
    const visualState = getArcProgressState({ completed, total: arc.episodes.length, isCurrent: active });
    return `<details class="opu-arc opu-arc-${visualState}" ${active ? 'open' : ''}>
      <summary><span>${arc.name}</span><small>${completed} / ${arc.episodes.length} ${t('completed')}</small></summary>
      <div class="opu-arc-actions">
        <button class="opu-arc-complete" data-action="complete-arc" data-arc-key="${arc.key}">✓ ${t('markArcCompleted')}</button>
        ${active ? `<button class="opu-arc-reset" data-action="reset-current">↺ ${t('reset')}</button>` : ''}
      </div>
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
  const adjacent = getAdjacentEpisodes(arcs);

  root.innerHTML = `<header class="opu-header">
    <div><strong>${t('arcMaster')}</strong><span>${latest ? `${t('resumeAt')}: ${latest.episodeNumber}. Bölüm · ${formatTime(latest.positionSeconds)}` : t('history')}</span></div>
    <span><button class="opu-collapse" aria-label="${t('closeArc')}">×</button><button class="opu-settings-toggle" aria-label="${t('settings')}">⚙</button></span>
  </header>
  <nav class="opu-episode-nav">
    ${adjacent.previous ? `<a href="/bolum/${adjacent.previous.number}">← ${adjacent.previous.number}</a>` : '<span></span>'}
    ${adjacent.next ? `<a href="/bolum/${adjacent.next.number}">${adjacent.next.number} →</a>` : '<span></span>'}
  </nav>
  ${latest ? `<a class="opu-resume" href="/bolum/${latest.episodeNumber}">▶ ${t('resume')}</a>` : ''}
  <div class="opu-arcs">${arcMarkup || `<p class="opu-empty">${t('loading')}</p>`}</div>`;
  nativeList.parentElement.insertBefore(root, nativeList);

  document.getElementById(CONTROL_DOCK_ID)?.remove();
  const episodeControls = document.querySelector('.episode-btns');
  const searchInput = document.querySelector('input[placeholder*="Sezon Ara"]');
  const searchControls = searchInput?.closest('[class*="search"]') ?? searchInput?.parentElement;
  const nativeMarkControl = [...document.querySelectorAll('button, a')].find(
    (element) => /^bölümü işaretle!?$/i.test(element.textContent.trim())
  );
  episodeControls?.style.setProperty('display', 'none', 'important');
  searchControls?.parentElement?.style.setProperty('display', 'none', 'important');
  nativeMarkControl?.parentElement?.style.setProperty('display', 'none', 'important');

  const drawer = document.createElement('aside');
  drawer.id = SETTINGS_DRAWER_ID;
  drawer.className = 'opu-settings';
  drawer.hidden = true;
  drawer.innerHTML = `
    <header><strong>${t('settings')}</strong><button data-action="close-settings">×</button></header>
    <label>${t('language')} <select data-setting="language"><option value="tr" ${settings.language === 'tr' ? 'selected' : ''}>Türkçe</option><option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option><option value="es" ${settings.language === 'es' ? 'selected' : ''}>Español</option></select></label>
    <label><input type="checkbox" data-setting="useResume" ${settings.useResume ? 'checked' : ''}> ${t('resumePosition')}</label>
    <label>${t('newStart')} <input type="number" min="0" data-setting="customStartSeconds" value="${settings.customStartSeconds}"> sn</label>
    <label>${t('speed')} <select data-setting="playbackRate">${[1, 1.25, 1.5, 2].map((rate) => `<option value="${rate}" ${settings.playbackRate === rate ? 'selected' : ''}>${rate}×</option>`).join('')}</select></label>
    <label>${t('source')} <select data-setting="preferredSource"><option value="automatic">Otomatik</option>${sourceOptions.map((source) => `<option value="${source}" ${settings.preferredSource === source ? 'selected' : ''}>${source}</option>`).join('')}</select></label>
    <label><input type="checkbox" data-setting="autoAdvance" ${settings.autoAdvance ? 'checked' : ''}> ${t('autoAdvance')}</label>
    <button data-action="complete">${t('markCompleted')}</button>
    <button data-action="reset">${t('reset')}</button>
  `;
  document.body.append(drawer);

  root.querySelector('.opu-settings-toggle').addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
  });
  root.querySelector('.opu-collapse').addEventListener('click', async () => {
    settings.arcMasterOpen = false;
    await setSyncStorage({ [SETTINGS_KEY]: settings });
    render();
  });
  drawer.querySelector('[data-action="close-settings"]').addEventListener('click', () => { drawer.hidden = true; });
  drawer.querySelectorAll('[data-setting]').forEach((control) => control.addEventListener('change', async () => {
    const key = control.dataset.setting;
    settings[key] = control.type === 'checkbox' ? control.checked : key === 'preferredSource' ? control.value : Number(control.value);
    await setSyncStorage({ [SETTINGS_KEY]: settings });
    applyPlayerPreferences();
    if (key === 'language') render();
  }));
  drawer.querySelector('[data-action="complete"]').addEventListener('click', () => saveProgress(0, getRecord(currentEpisode)?.durationSeconds || 0, true));
  drawer.querySelector('[data-action="reset"]').addEventListener('click', () => {
    progressRecords = progressRecords.filter((record) => record.episodeNumber !== currentEpisode);
    setStorage({ [PROGRESS_KEY]: progressRecords });
    render();
  });
  root.querySelectorAll('[data-action="complete-arc"]').forEach((button) => button.addEventListener('click', () => {
    const arc = arcs.find((item) => item.key === button.dataset.arcKey);
    if (arc) markArcCompleted(arc);
  }));
  root.querySelector('[data-action="reset-current"]')?.addEventListener('click', () => {
    progressRecords = progressRecords.filter((record) => record.episodeNumber !== currentEpisode);
    setStorage({ [PROGRESS_KEY]: progressRecords });
    render();
  });

  window.__onepaceUtilitiesArcs = arcs;
  applyPlayerPreferences();
  requestAnimationFrame(() => {
    const arcScroller = root.querySelector('.opu-arcs');
    const activeCard = root.querySelector('.opu-episode.active');
    if (arcScroller && activeCard) {
      arcScroller.scrollTop = activeCard.offsetTop - arcScroller.offsetTop - arcScroller.clientHeight / 2;
    }
  });

  if (!settings.arcMasterOpen) {
    const arcToggle = document.createElement('button');
    arcToggle.id = 'onepace-utilities-arc-toggle';
    arcToggle.textContent = `≡ ${t('openArc')}`;
    arcToggle.addEventListener('click', async () => {
      settings.arcMasterOpen = true;
      await setSyncStorage({ [SETTINGS_KEY]: settings });
      render();
    });
    document.body.append(arcToggle);
  }
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
