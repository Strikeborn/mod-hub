type Props = {
  author?: string;
  steamId?: string;
  profileUrl?: string;
  /** When set, the link opens the author's Workshop items for this game. */
  appId?: number;
};

/** Author name; Steam authors open their Workshop page inside the Steam app. */
export function AuthorLink({ author, steamId, profileUrl, appId }: Props) {
  const label = author?.trim() || 'Unknown';
  const base = profileUrl ?? (steamId ? `https://steamcommunity.com/profiles/${steamId}` : undefined);
  if (!base || !steamId) return <span>{label}</span>;
  const url = appId ? `${base.replace(/\/$/, '')}/myworkshopfiles/?appid=${appId}` : base;
  return (
    <a
      href={url}
      title={appId ? `${label}'s Workshop items (opens in Steam)` : `Steam profile ${steamId} (opens in Steam)`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void window.modHub?.openInSteam(url);
      }}
    >
      {label}
    </a>
  );
}
