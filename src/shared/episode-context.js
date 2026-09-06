export function formatEpisodeContext({ arcName, episodeNumber, episodeName, episodeLabel = 'Bölüm' }) {
  const episode = `${episodeNumber}. ${episodeLabel}: ${episodeName}`;
  return arcName ? `${arcName} · ${episode}` : episode;
}
