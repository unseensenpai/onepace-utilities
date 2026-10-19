// Builds src/shared/one-piece-titles.js: One Piece episode titles in English and Spanish from the
// Wikipedia season pages. Turkish titles, and Spanish ones Wikipedia leaves in English, are
// translations of the English titles kept in scripts/data/one-piece-titles-<language>.json.
// Run with: node scripts/build-episode-titles.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const CACHE = new URL('scripts/.cache/', ROOT);
const TRANSLATIONS = new URL('scripts/data/', ROOT);
const OUTPUT = new URL('src/shared/one-piece-titles.js', ROOT);
const SPANISH_SEASONS = ['Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta', 'Séptima', 'Octava', 'Novena',
  'Décima', 'Undécima', 'Duodécima', 'Decimotercera', 'Decimocuarta', 'Decimoquinta', 'Decimosexta', 'Decimoséptima',
  'Decimoctava', 'Decimonovena', 'Vigésima', 'Vigesimoprimera', 'Vigesimosegunda', 'Vigesimotercera', 'Vigesimocuarta'];
const NUMBER_FIELD = /^(?:EpisodeNumber|EpisodioNúmero|NúmeroEpisodio)2?(_\d+)?$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wikitext(host, page) {
  const file = new URL(encodeURIComponent(`${host}-${page}`) + '.txt', CACHE);
  try {
    return await readFile(file, 'utf8') || null;
  } catch {}
  const query = new URLSearchParams({ action: 'parse', page, prop: 'wikitext', format: 'json', formatversion: '2', redirects: '1' });
  for (const wait of [5, 15, 30, 60, 90, 0]) {
    const response = await fetch(`https://${host}/w/api.php?${query}`, {
      headers: { 'User-Agent': 'onepace-utilities-titles/1.0 (https://github.com/unseensenpai/onepace-utilities)' }
    });
    if (response.status === 429 && wait) {
      await sleep(wait * 1000);
      continue;
    }
    const text = (await response.json()).parse?.wikitext ?? '';
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, text);
    await sleep(1500);
    return text || null;
  }
  throw new Error(`Rate limited: ${host} ${page}`);
}

function clean(text = '') {
  return text
    .replace(/\{\{Ruby-ja\|([^|}]*)\|[^}]*\}\}/g, '$1')
    .replace(/<ref[^>]*\/>|<ref[^>]*>.*?<\/ref>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    // A field written on the same line as the title ("Title | TranslitTitle = ...").
    .replace(/\s*\|\s*\w+\s*=.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Specials are numbered like "1004.5" or "SP 1" and recap series restart from 1, so only whole
// numbers after the previous season's last episode count.
function parseEpisodes(text, template, titleField, episodes) {
  const floor = Math.max(0, ...Object.keys(episodes).map(Number));
  for (const block of text.split(new RegExp(`\\{\\{\\s*(?:#invoke:)?${template}`)).slice(1)) {
    const fields = Object.fromEntries([...block.split('\n}}')[0].matchAll(/^\|\s*([^=\n|]+?)\s*=\s*(.*?)\s*$/gm)]
      .map((match) => [match[1], match[2]]));
    const groups = {};
    for (const [key, value] of Object.entries(fields)) {
      const field = key.match(NUMBER_FIELD);
      if (field && /^\d+$/.test(value.trim())) (groups[field[1] ?? ''] ??= []).push(Number(value));
    }
    // Pages disagree on which of the two number fields is the overall one; it is the larger.
    for (const numbers of Object.values(groups)) {
      const number = Math.max(...numbers);
      if (number > floor) episodes[number] = { title: clean(fields[titleField]) };
    }
  }
  return episodes;
}

// Spanish pages leave untranslated episodes in English; those fall back to the English column anyway.
function untranslated(english, spanish) {
  return Object.fromEntries(Object.entries(spanish)
    .filter(([number, episode]) => episode.title && episode.title !== english[number]?.title)
    .map(([number, episode]) => [number, episode.title]));
}

// Translations of the English titles, kept as { "episode": "title" } so they can be reviewed and
// fixed by hand; a missing file or entry falls back to English.
async function readTranslations(language) {
  try {
    return JSON.parse(await readFile(new URL(`one-piece-titles-${language}.json`, TRANSLATIONS), 'utf8'));
  } catch {
    console.warn(`No translations at scripts/data/one-piece-titles-${language}.json.`);
    return {};
  }
}

const english = {};
for (let season = 1; ; season += 1) {
  const text = await wikitext('en.wikipedia.org', `One Piece season ${season}`);
  if (!text) break;
  parseEpisodes(text, 'Episode list', 'Title', english);
}
const spanishRaw = {};
for (const ordinal of SPANISH_SEASONS) {
  const text = await wikitext('es.wikipedia.org', `Anexo:${ordinal} temporada de One Piece`);
  if (!text) break;
  parseEpisodes(text, 'Lista de episodios', 'Título', spanishRaw);
}
// The Spanish translations cover exactly the episodes Wikipedia leaves in English, so they win.
const spanish = { ...untranslated(english, spanishRaw), ...(await readTranslations('es')) };
const turkish = await readTranslations('tr');

const last = Math.max(...Object.keys(english).map(Number));
// A few season 1 entries hold two dub titles as 'A" / "B'; the first one is kept.
const firstTitle = (title) => title.split('" / "')[0];
const column = (titles, pick = (value) => value) => Array.from({ length: last }, (_, i) => (titles[i + 1] ? firstTitle(pick(titles[i + 1])) : ''));
const languages = {
  tr: column(turkish),
  en: column(english, (episode) => episode.title),
  es: column(spanish)
};

const source = `// Generated by scripts/build-episode-titles.mjs; do not edit by hand.
// English: en.wikipedia.org "One Piece season N" pages. Spanish: es.wikipedia.org season annexes.
// Turkish, and Spanish gaps: translations in scripts/data/. Index i is episode i + 1; '' means unknown.
(function initializeOnePieceTitles(globalObject) {
  const TITLES = ${JSON.stringify(languages, null, 0).replace(/\],"/g, '],\n    "').replace(/^\{/, '{\n    ').replace(/\}$/, '\n  }')};

  // Falls back to English when the language has no title for the episode.
  function episodeTitle(episodeNumber, language) {
    const index = Number(episodeNumber) - 1;
    return TITLES[language]?.[index] || TITLES.en[index] || '';
  }

  // The browser language when it is one of ours, English otherwise.
  function preferredLanguage(browserLanguage) {
    const language = String(browserLanguage ?? '').slice(0, 2).toLowerCase();
    return Object.hasOwn(TITLES, language) ? language : 'en';
  }

  globalObject.OnePieceTitles = Object.freeze({ episodeTitle, preferredLanguage, lastEpisode: ${last} });
})(globalThis);
`;
await writeFile(OUTPUT, source);
const count = (list) => list.filter(Boolean).length;
console.log(`Episodes 1-${last}: tr ${count(languages.tr)}, en ${count(languages.en)}, es ${count(languages.es)}`);
