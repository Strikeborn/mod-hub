import { useEffect, useState } from 'react';

type Props = {
  appId: number;
  name: string;
};

function steamArtUrl(appId: number, stage: number): string {
  const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}`;
  switch (stage) {
    case 0:
      return `${base}/library_600x900.jpg`;
    case 1:
      return `${base}/library_600x900_2x.jpg`;
    case 2:
      return `${base}/library_hero.jpg`;
    case 3:
      return `${base}/header.jpg`;
    case 4:
      return `${base}/capsule_616x353.jpg`;
    case 5:
      return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
    case 6:
      return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
    default:
      return '';
  }
}

/** Session cache of the Steam client's local art lookups (null = not in the local cache). */
const localArt = new Map<number, string | null>();

export function GameCoverImage({ appId, name }: Props) {
  const [local, setLocal] = useState<string | null | undefined>(localArt.get(appId));
  const [stage, setStage] = useState(0);

  // Steam's own library cache first: it has art for every installed game, including new ones whose
  // store images live under hashed URLs the guesses below can't reach.
  useEffect(() => {
    if (localArt.has(appId) || !window.modHub?.getSteamGameArt) {
      setLocal(localArt.get(appId) ?? null);
      return;
    }
    let cancelled = false;
    void window.modHub.getSteamGameArt(appId).then((art) => {
      localArt.set(appId, art);
      if (!cancelled) setLocal(art);
    });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (local) return <img src={local} alt="" />;
  if (local === undefined) return <span aria-hidden>…</span>;
  if (stage >= 7) return <span>{name.slice(0, 1)}</span>;

  return (
    <img
      src={steamArtUrl(appId, stage)}
      alt=""
      loading="lazy"
      onError={() => setStage((s) => s + 1)}
    />
  );
}
