export interface OldestCast {
  text: string;
  timestamp: string;
  hash: string;
  username: string;
  pfpUrl: string;
  likes: number;
  recasts: number;
}

const NEYNAR_BASE = "https://api.neynar.com";

function neynarHeaders(): Record<string, string> {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) throw new Error("NEYNAR_API_KEY is not set");
  return { "x-api-key": key, accept: "application/json" };
}

function toCast(c: NeynarCast): OldestCast {
  return {
    text: c.text,
    timestamp: c.timestamp,
    hash: c.hash,
    username: c.author.username,
    pfpUrl: c.author.pfp_url ?? "",
    likes: c.reactions?.likes_count ?? 0,
    recasts: c.reactions?.recasts_count ?? 0,
  };
}

export async function getOldestCast(fid: number): Promise<OldestCast | null> {
  try {
    const via_search = await trySearchEndpoint(fid);
    if (via_search) return via_search;
    return await paginateFeed(fid);
  } catch {
    return null;
  }
}

async function trySearchEndpoint(fid: number): Promise<OldestCast | null> {
  const url = `${NEYNAR_BASE}/v2/farcaster/cast/search?q=&author_fid=${fid}&sort_type=chron&limit=1`;
  const res = await fetch(url, { headers: neynarHeaders() });
  if (!res.ok) return null;
  const json = (await res.json()) as { result?: { casts?: NeynarCast[] } };
  const cast = json.result?.casts?.[0];
  if (!cast) return null;
  return toCast(cast);
}

async function paginateFeed(fid: number): Promise<OldestCast | null> {
  let cursor: string | undefined;
  let oldest: NeynarCast | null = null;

  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      fid: String(fid),
      limit: "150",
    });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `${NEYNAR_BASE}/v2/farcaster/feed/user/casts?${params}`,
      { headers: neynarHeaders() },
    );
    if (!res.ok) break;

    const json = (await res.json()) as {
      casts?: NeynarCast[];
      next?: { cursor?: string };
    };

    const casts = json.casts ?? [];
    if (casts.length > 0) {
      oldest = casts[casts.length - 1] ?? null;
    }

    const next = json.next?.cursor;
    if (!next) break;
    cursor = next;
  }

  return oldest ? toCast(oldest) : null;
}

interface NeynarCast {
  text: string;
  timestamp: string;
  hash: string;
  author: { username: string; pfp_url?: string };
  reactions?: { likes_count?: number; recasts_count?: number };
}
