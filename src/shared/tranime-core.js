(function initializeTranimeCore(globalObject) {
  // Episode pages are /<anime-slug>-<number>-bolum-izle, sometimes with a suffix (episode 1 is "-izle-hd").
  const EPISODE_PATH = /^\/([a-z0-9-]+?)-(\d+)-bolum-izle(?:-[a-z0-9-]+)?\/?$/;

  function parseEpisodePath(pathname) {
    const match = String(pathname ?? '').match(EPISODE_PATH);
    if (!match) return null;
    return { slug: match[1], episode: Number(match[2]) };
  }

  // Episode number -> path, read from the site's own episode list since paths are not uniform.
  function collectEpisodeLinks(slug, paths) {
    const links = {};
    for (const path of paths ?? []) {
      const parsed = parseEpisodePath(path);
      if (parsed?.slug === slug) links[parsed.episode] = path;
    }
    return links;
  }

  function episodeLink(links, slug, episode) {
    return links?.[episode] ?? `/${slug}-${episode}-bolum-izle`;
  }

  globalObject.TranimeCore = Object.freeze({ parseEpisodePath, collectEpisodeLinks, episodeLink });
})(globalThis);
