export function buildArcMaster(episodes) {
  const arcs = new Map();

  for (const episode of episodes) {
    const season = episode.season;
    if (!season?.slug) continue;

    if (!arcs.has(season.slug)) {
      arcs.set(season.slug, {
        key: season.slug,
        name: season.name,
        plannedEpisodes: season.total ?? 0,
        episodes: []
      });
    }

    arcs.get(season.slug).episodes.push({
      key: `${season.slug}-${episode.number}`,
      number: episode.number,
      name: episode.name,
      duration: episode.duration,
      manga: episode.manga,
      anime: episode.anime
    });
  }

  return [...arcs.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((arc) => ({
      ...arc,
      episodes: arc.episodes.sort((left, right) => left.number - right.number)
    }));
}

export function getArcProgressState({ completed, total, isCurrent }) {
  if (total > 0 && completed === total) return 'completed';
  if (isCurrent) return 'active';
  return 'untouched';
}
