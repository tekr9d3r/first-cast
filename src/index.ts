import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import {
  SPEC_VERSION,
  type SnapFunction,
  type SnapHandlerResult,
} from "@farcaster/snap";
import { registerSnapHandler } from "@farcaster/snap-hono";
import {
  createInMemoryDataStore,
  createTursoDataStore,
} from "@farcaster/snap-turso";
import { getOldestCast, type OldestCast } from "./neynar.js";

const store =
  process.env.VERCEL === "1"
    ? createTursoDataStore()
    : createInMemoryDataStore();

const snap: SnapFunction = async (ctx) => {
  const base = snapBaseUrl(ctx.request);

  if (ctx.action.type === "get") {
    return landingScreen(base);
  }

  const fid = ctx.action.user?.fid;
  if (!fid) return landingScreen(base);

  const cacheKey = `oldest_cast:${fid}`;
  const cached = await store.get(cacheKey);
  if (cached) {
    return resultScreen(base, JSON.parse(String(cached)) as OldestCast);
  }

  const cast = await getOldestCast(fid);
  if (!cast) return notFoundScreen();

  await store.set(cacheKey, JSON.stringify(cast));
  return resultScreen(base, cast);
};

const __dir = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dir, "../assets/fonts");

const app = new Hono();

registerSnapHandler(app, snap, {
  og: {
    fonts: [
      { path: join(fontsDir, "inter-latin-400-normal.woff"), weight: 400 },
      { path: join(fontsDir, "inter-latin-700-normal.woff"), weight: 700 },
    ],
  },
});

export default app;

// ─── Screens ─────────────────────────────────────────────

function landingScreen(base: string): SnapHandlerResult {
  return {
    version: SPEC_VERSION,
    theme: { accent: "purple" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: ["hero", "title", "subtitle", "btn-find"],
        },
        hero: {
          type: "image",
          props: {
            url: "https://placehold.co/600x338/8A63D2/ffffff.png?text=Your+First+Cast",
            aspect: "16:9",
            alt: "Your First Cast",
          },
        },
        title: {
          type: "item",
          props: { title: "Your First Cast" },
        },
        subtitle: {
          type: "text",
          props: {
            content: "Rediscover the first thing you ever said on Farcaster.",
            size: "sm",
          },
        },
        "btn-find": {
          type: "button",
          props: { label: "Find My First Cast ⚡", variant: "primary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/` },
            },
          },
        },
      },
    },
  };
}

function resultScreen(base: string, cast: OldestCast): SnapHandlerResult {
  const date = formatDate(cast.timestamp);
  const userLabel = clamp(`@${cast.username}`, 100);
  const castText = clamp(cast.text, 320);
  const likesLabel = clamp(`❤️ ${cast.likes}`, 30);
  const recastsLabel = clamp(`🔄 ${cast.recasts}`, 30);
  const shareText = buildShareText(cast);

  return {
    version: SPEC_VERSION,
    theme: { accent: "purple" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: [
            "profile",
            "sep1",
            "cast-text",
            "sep2",
            "stats-row",
            "btn-share",
            "footer",
          ],
        },
        profile: {
          type: "item",
          props: {
            title: userLabel,
            description: date,
            ...(cast.pfpUrl
              ? { media: { variant: "image", url: cast.pfpUrl, alt: `${cast.username} avatar`, round: true } }
              : {}),
          },
        },
        sep1: { type: "separator", props: {} },
        "cast-text": {
          type: "text",
          props: { content: castText },
        },
        sep2: { type: "separator", props: {} },
        "stats-row": {
          type: "stack",
          props: { direction: "horizontal" },
          children: ["likes-badge", "recasts-badge"],
        },
        "likes-badge": {
          type: "badge",
          props: { label: likesLabel, color: "red" },
        },
        "recasts-badge": {
          type: "badge",
          props: { label: recastsLabel, color: "green" },
        },
        "btn-share": {
          type: "button",
          props: { label: "Share This Memory 🕰️", variant: "primary" },
          on: {
            press: {
              action: "compose_cast",
              params: {
                text: shareText,
                embeds: ["https://first-cast.vercel.app/"],
              },
            },
          },
        },
        footer: {
          type: "badge",
          props: { label: "oldest available cast", color: "gray" },
        },
      },
    },
  };
}

function notFoundScreen(): SnapHandlerResult {
  return {
    version: SPEC_VERSION,
    theme: { accent: "gray" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: ["title", "msg"],
        },
        title: {
          type: "item",
          props: { title: "No casts found" },
        },
        msg: {
          type: "text",
          props: {
            content:
              "We couldn't find any casts for your account. Cast something on Farcaster first!",
            size: "sm",
          },
        },
      },
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────

function snapBaseUrl(request: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = request.headers.get("host");
  const host = (forwardedHost ?? hostHeader)?.split(",")[0].trim();
  const isLoopback =
    host !== undefined &&
    /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = forwardedProto
    ? forwardedProto.split(",")[0].trim().toLowerCase()
    : isLoopback
      ? "http"
      : "https";
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return `http://localhost:${process.env.PORT ?? "3003"}`.replace(/\/$/, "");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildShareText(cast: OldestCast): string {
  const date = formatDate(cast.timestamp);
  const excerpt =
    cast.text.length > 200 ? cast.text.slice(0, 197) + "..." : cast.text;
  return `My first ever cast on Farcaster 🕰️\n\n"${excerpt}"\n\n— posted ${date}\n\nvia @tekrox.eth`;
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}
