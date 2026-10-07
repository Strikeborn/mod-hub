export interface WorkshopDetails {
  publishedfileid: string;
  title: string;
  time_updated: number;
  time_created: number;
  file_size?: number;
  preview_url?: string;
  creator?: string;
  banned?: boolean;
  consumer_app_id?: number;
  result?: number;
  votes_up?: number;
  votes_down?: number;
  score?: number;
  tags?: string[];
}

export type WorkshopFetchProgress = (info: {
  fetched: number;
  total: number;
  chunk: number;
  chunkTotal: number;
}) => void;

export async function fetchWorkshopDetails(
  ids: string[],
  onProgress?: WorkshopFetchProgress,
): Promise<Map<string, WorkshopDetails>> {
  const { map } = await fetchWorkshopDetailsWithStats(ids, onProgress);
  return map;
}

export async function fetchWorkshopDetailsWithStats(
  ids: string[],
  onProgress?: WorkshopFetchProgress,
): Promise<{ map: Map<string, WorkshopDetails>; failedChunks: number }> {
  const map = new Map<string, WorkshopDetails>();
  const unique = [...new Set(ids.filter(Boolean))];
  const chunkSize = 50;
  const chunkTotal = Math.max(1, Math.ceil(unique.length / chunkSize));
  let failedApiChunks = 0;

  const chunks: { chunk: string[]; chunkIndex: number }[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push({ chunk: unique.slice(i, i + chunkSize), chunkIndex: Math.floor(i / chunkSize) + 1 });
  }
  let fetched = 0;
  onProgress?.({ fetched: 0, total: unique.length, chunk: 0, chunkTotal });

  const runChunk = async ({ chunk, chunkIndex }: { chunk: string[]; chunkIndex: number }) => {
    const done = () => {
      fetched += chunk.length;
      onProgress?.({ fetched, total: unique.length, chunk: chunkIndex, chunkTotal });
    };
    const body = new URLSearchParams();
    body.set('itemcount', String(chunk.length));
    chunk.forEach((id, idx) => body.set(`publishedfileids[${idx}]`, id));

    let res: Response;
    try {
      res = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (e) {
      failedApiChunks += 1;
      console.warn(`[Mod Hub] Workshop API chunk ${chunkIndex}/${chunkTotal} failed:`, e);
      done();
      return;
    }
    if (!res.ok) {
      failedApiChunks += 1;
      console.warn(`[Mod Hub] Workshop API chunk ${chunkIndex}/${chunkTotal} HTTP ${res.status}`);
      done();
      return;
    }
    const json = (await res.json()) as {
      response?: { publishedfiledetails?: Array<Record<string, unknown>> };
    };
    const details = json.response?.publishedfiledetails ?? [];
    for (const d of details) {
      const id = String(d.publishedfileid ?? '');
      if (!id) continue;
      const result = Number(d.result ?? 0);
      if (result !== 1) {
        map.set(id, {
          publishedfileid: id,
          title: `Workshop ${id}`,
          time_updated: 0,
          time_created: 0,
          result,
        });
        continue;
      }
      map.set(id, {
        publishedfileid: id,
        title: String(d.title ?? id),
        time_updated: Number(d.time_updated ?? 0),
        time_created: Number(d.time_created ?? 0),
        file_size: d.file_size != null ? Number(d.file_size) : undefined,
        preview_url: d.preview_url ? String(d.preview_url) : undefined,
        creator: d.creator != null ? String(d.creator) : undefined,
        banned: Boolean(d.banned),
        consumer_app_id: d.consumer_app_id != null ? Number(d.consumer_app_id) : undefined,
        result: 1,
        votes_up: d.votes_up != null ? Number(d.votes_up) : undefined,
        votes_down: d.votes_down != null ? Number(d.votes_down) : undefined,
        score: d.score != null ? Number(d.score) : undefined,
        tags: Array.isArray(d.tags)
          ? (d.tags as Array<{ tag?: string }>).map((t) => String(t.tag ?? t)).filter(Boolean)
          : undefined,
      });
    }
    done();
  };

  // Every item is still checked (update detection needs all time_updated values); just 4 requests at a time.
  const queue = [...chunks];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) await runChunk(c);
    }),
  );

  if (failedApiChunks > 0) {
    console.warn(`[Mod Hub] Workshop API: ${failedApiChunks}/${chunkTotal} chunk(s) failed`);
  }

  return { map, failedChunks: failedApiChunks };
}

export function workshopItemUrl(appId: number, workshopId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
}

export function workshopSubscribeUrl(appId: number, workshopId: string): string {
  return `steam://url/CommunityFilePage/${workshopId}`;
}
