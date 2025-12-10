const DEFAULT_AGENT = "explorer";

export function buildBlobUrl(id, agent = DEFAULT_AGENT) {
    if (!id) return "";
    const safeId = encodeURIComponent(String(id).trim());
    const safeAgent = encodeURIComponent(String(agent || DEFAULT_AGENT).trim() || DEFAULT_AGENT);
    const origin = (typeof window !== "undefined" && window.location?.origin)
        ? window.location.origin
        : `http://localhost:${process.env.PLOINKY_ROUTER_PORT || process.env.PORT || 8080}`;
    return `${origin}/blobs/${safeAgent}/${safeId}`;
}
