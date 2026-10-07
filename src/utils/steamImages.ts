export function steamLibraryImage(appId: number): string {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`;
}

export function steamHeaderImage(appId: number): string {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

export function workshopBrowseUrl(appId: number, sort: WorkshopBrowseSort = 'trend'): string {
  const browsesort =
    sort === 'recent'
      ? 'mostrecent'
      : sort === 'subscribed'
        ? 'mostsubscribed'
        : sort === 'rated'
          ? 'toprated'
          : 'trend';
  return `https://steamcommunity.com/workshop/browse/?appid=${appId}&browsesort=${browsesort}&section=readytouseitems`;
}

export type WorkshopBrowseSort = 'trend' | 'recent' | 'subscribed' | 'rated';
