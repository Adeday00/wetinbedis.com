import { projectToTVPage } from "./project-to-tv-page";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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
    if (url.pathname === "/join" || url.pathname === "/join/") {
      return projectToTVPage(request);
    }
    // Let the existing custom-domain Worker handle any other path matched by
    // the prefix route (for example /join-preview).
    return fetch(request);
  },
};
