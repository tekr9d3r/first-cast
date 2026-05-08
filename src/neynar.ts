export interface OldestCast {
  text: string;
  timestamp: string;
  hash: string;
  username: string;
  pfpUrl: string;
  likes: number;
  recasts: number;
}

const NEYNAR_API_BASE = "https://api.neynar.com";
// Public Farcaster hub — no API key needed, returns oldest-first by default
const PINATA_HUB_BASE = "https://hub.pinata.cloud";
// Farcaster timestamps are seconds since Jan 1, 2021 00:00:00 UTC
const FARCASTER_EPOCH_MS = 1_609_459_200_000;
// Fallback pagination budget
const PAGINATION_DEADLINE_MS = 40_000;

function apiHeaders(): Record<string, string> {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) throw new Error("NEYNAR_API_KEY is not set");
  return { "x-api-key": key, accept: "application/json" };
}

export async function getOldestCast(fid: number): Promise<OldestCast | null> {
  try {
    const fromHub = await tryPublicHub(fid);
    if (fromHub) return fromHub;
    return await paginateFeed(fid);
  } catch {
    return null;
  }
}

// ─── Primary: Pinata public hub (no auth, O(1)) ──────────

async function tryPublicHub(fid: number): Promise<OldestCast | null> {
  // reverse=false (default) → oldest first; pageSize=1 → just the first
  const res = await fetch(
    `${PINATA_HUB_BASE}/v1/castsByFid?fid=${fid}&pageSize=1`,
  );
  if (!res.ok) return null;

  const json = (await res.json()) as { messages?: HubMessage[] };
  const msg = json.messages?.[0];
  if (!msg?.data) return null;

  const castBody = msg.data.castAddBody;
  if (!castBody) return null;

  const timestamp = new Date(
    FARCASTER_EPOCH_MS + msg.data.timestamp * 1000,
  ).toISOString();

  const profile = await getUserProfile(fid);

  return {
    text: castBody.text ?? "",
    timestamp,
    hash: msg.hash ?? "",
    username: profile?.username ?? `fid:${fid}`,
    pfpUrl: profile?.pfp_url ?? "",
    likes: 0,
    recasts: 0,
  };
}

async function getUserProfile(
  fid: number,
): Promise<{ username: string; pfp_url?: string } | null> {
  const res = await fetch(
    `${NEYNAR_API_BASE}/v2/farcaster/user/bulk?fids=${fid}`,
    { headers: apiHeaders() },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    users?: { username: string; pfp_url?: string }[];
  };
  return json.users?.[0] ?? null;
}

// ─── Fallback: paginate Neynar feed (newest-first, walk to end) ─

async function paginateFeed(fid: number): Promise<OldestCast | null> {
  let cursor: string | undefined;
  let oldest: NeynarCast | null = null;
  const deadline = Date.now() + PAGINATION_DEADLINE_MS;

  while (Date.now() < deadline) {
    const params = new URLSearchParams({ fid: String(fid), limit: "150" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(
      `${NEYNAR_API_BASE}/v2/farcaster/feed/user/casts?${params}`,
      { headers: apiHeaders() },
    );
    if (!res.ok) break;

    const json = (await res.json()) as {
      casts?: NeynarCast[];
      next?: { cursor?: string };
    };

    const casts = json.casts ?? [];
    if (casts.length > 0) oldest = casts[casts.length - 1] ?? null;

    const next = json.next?.cursor;
    if (!next) break;
    cursor = next;
  }

  return oldest ? toCast(oldest) : null;
}

// ─── Types ───────────────────────────────────────────────

function toCast(c: NeynarCast): OldestCast {
  return {
    text: c.text,
    timestamp: c.timestamp,
    hash: c.hash,
    username: c.author.username,
    pfpUrl: c.author.pfp_url ?? "",
    likes: 0,
    recasts: 0,
  };
}

interface HubMessage {
  hash?: string;
  data?: {
    timestamp: number;
    castAddBody?: { text?: string };
  };
}

interface NeynarCast {
  text: string;
  timestamp: string;
  hash: string;
  author: { username: string; pfp_url?: string };
}
