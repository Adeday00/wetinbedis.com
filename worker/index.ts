/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleApiRequest, reconcileCompetitionLifecycle } from "./api/router";
import { PlayOnCallRoom } from "./play-on-call-room";
import { projectToTVPage } from "./project-to-tv-page";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PLAY_ON_CALL_ROOMS?: DurableObjectNamespace;
  WBD_CONTENT_ADMIN_TOKEN?: string;
  WBD_CARD_PREVIEW_TOKEN?: string;
  WBD_CONTENT_ADMIN_USER_IDS?: string;
  WBD_CONTENT_ADMIN_EMAILS?: string;
  WBD_APPLE_TEAM_ID?: string;
  WBD_APPLE_KEY_ID?: string;
  WBD_APPLE_CLIENT_ID?: string;
  WBD_APPLE_PRIVATE_KEY?: string;
  WBD_ADMIN_SESSION_SECRET?: string;
  WBD_APPLE_ALLOWED_EMAILS?: string;
  WBD_APPLE_ALLOWED_SUBS?: string;
  FIREBASE_WEB_API_KEY?: string;
  WBD_PUSH_TOKEN_ENCRYPTION_SECRET?: string;
  WBD_APNS_KEY_ID?: string;
  WBD_APNS_TEAM_ID?: string;
  WBD_APNS_PRIVATE_KEY?: string;
  WBD_APNS_BUNDLE_ID?: string;
  WBD_APNS_HOST?: string;
  WBD_APP_ATTEST_APP_ID?: string;
  WBD_APP_ATTEST_ENVIRONMENT?: string;
  WBD_PLAY_ON_CALL_SIGNING_SECRET?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  WBD_GOOGLE_REVIEW_ACCESS_CODE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (url.pathname === "/" || url.pathname === "/screen" || url.pathname === "/screen/"
      || url.pathname === "/tv" || url.pathname === "/tv/"
      || url.pathname === "/join" || url.pathname === "/join/"
      || url.pathname === "/.well-known/apple-app-site-association") {
      return projectToTVPage(request);
    }

    if (url.pathname === "/.well-known/assetlinks.json") {
      return new Response(JSON.stringify([{
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.davidadekanbi.wetinbedis",
          sha256_cert_fingerprints: ["69:6A:C5:3A:04:78:6C:97:B4:5A:00:EB:46:E8:BA:60:D6:CB:A8:F4:AA:32:5D:4B:A5:D5:8A:DD:12:3E:F3:72"],
        },
      }]), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const apiResponse = await handleApiRequest(request, env);
    if (apiResponse) return apiResponse;

    return handler.fetch(request, env, ctx);
  },
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.DB) ctx.waitUntil(reconcileCompetitionLifecycle(env.DB));
  },
};

export default worker;
export { PlayOnCallRoom };
