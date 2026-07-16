const UPSTREAM_HOST = "d2f-gestion.d2fcompliant.workers.dev";
const PUBLIC_ORIGIN = "https://gestion.d2fcompliant.org";

export default {
  async fetch(request, env) {
    if (!env.D2F_GATEWAY_SECRET) return new Response("Gateway unavailable", { status: 503 });

    const upstreamUrl = new URL(request.url);
    upstreamUrl.protocol = "https:";
    upstreamUrl.hostname = UPSTREAM_HOST;
    upstreamUrl.port = "";

    const upstreamRequest = new Request(upstreamUrl, request);
    upstreamRequest.headers.set("x-d2f-gateway", env.D2F_GATEWAY_SECRET);
    upstreamRequest.headers.set("x-forwarded-host", new URL(PUBLIC_ORIGIN).host);
    upstreamRequest.headers.set("x-forwarded-proto", "https");

    const response = await fetch(upstreamRequest, { redirect: "manual" });
    const headers = new Headers(response.headers);
    const location = headers.get("location");
    if (location) headers.set("location", location.replace(`https://${UPSTREAM_HOST}`, PUBLIC_ORIGIN));

    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
