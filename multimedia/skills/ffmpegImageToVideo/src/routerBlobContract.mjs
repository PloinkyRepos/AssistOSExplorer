const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

export function resolvePloinkyRouterUrl(env = process.env) {
  const raw = typeof env.PLOINKY_ROUTER_URL === "string"
    ? env.PLOINKY_ROUTER_URL.trim()
    : "";
  if (!raw) {
    throw new Error("PLOINKY_ROUTER_URL is required for router blob operations.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PLOINKY_ROUTER_URL must be a valid HTTP(S) origin URL.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("PLOINKY_ROUTER_URL must be a valid HTTP(S) origin URL.");
  }
  return parsed.origin;
}

function requireSegment(value, label) {
  const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required for router blob operations.`);
  return normalized;
}

export function buildRouterBlobCollectionUrl(agentId, routerBaseUrl) {
  const agent = requireSegment(agentId, "agentId");
  return new URL(`/blobs/${encodeURIComponent(agent)}`, routerBaseUrl).href;
}

export function buildRouterBlobUrl(blobId, { agentId, routerBaseUrl }) {
  const agent = requireSegment(agentId, "agentId");
  const id = requireSegment(blobId, "blobId");
  return new URL(
    `/blobs/${encodeURIComponent(agent)}/${encodeURIComponent(id)}`,
    routerBaseUrl,
  ).href;
}

export function resolveMediaSourceUrl(source, { agentId, routerBaseUrl }) {
  if (isHttpUrl(source)) return source;
  return buildRouterBlobUrl(source, { agentId, routerBaseUrl });
}

export function resolveRouterDownloadUrl(localPath, downloadUrl, routerBaseUrl) {
  const candidate = downloadUrl || localPath || "";
  if (!candidate) return "";
  if (isHttpUrl(candidate)) return candidate;
  return new URL(candidate.startsWith("/") ? candidate : `/${candidate}`, routerBaseUrl).href;
}
