import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Blob } from "node:buffer";
import ffmpegStatic from "ffmpeg-static";

const toNumber = (value, fallback = undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isHttp = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

const normalizeUrlForContainer = (url) => {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      u.hostname = process.env.HOST_LOOPBACK || "host.docker.internal";
    }
    return u.toString();
  } catch (_) {
    return url;
  }
};

const normalizeBaseUrl = (value) => {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
};

const resolveAgentId = (explicitAgentId) => {
  const candidates = [
    explicitAgentId,
    process.env.ASSISTOS_AGENT_ID,
    process.env.AGENT_ID,
    process.env.ACHILLES_AGENT_ID,
    "soplangAgent"
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "soplangAgent";
};

const resolveBlobBaseUrl = (explicitBaseUrl) => {
  const host = process.env.HOST_LOOPBACK || "host.docker.internal";
  const port = process.env.BLOB_PORT || process.env.PLOINKY_ROUTER_PORT || process.env.PORT || "8080";
  const defaults = `http://${host}:${port}`;
  const candidates = [
    explicitBaseUrl,
    process.env.FILE_EXPLORER_URL,
    process.env.BLOB_BASE_URL,
    process.env.BLOB_STORE_URL,
    process.env.PLOINKY_ROUTER_URL,
    process.env.ROUTER_URL,
    defaults
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }
  return defaults;
};

const normalizeDownloadUrl = (localPath, downloadUrl, baseUrl) => {
  const candidate = downloadUrl || localPath || "";
  if (!candidate) return "";
  if (isHttp(candidate)) return candidate;
  const normalizedPath = candidate.startsWith("/") ? candidate : `/${candidate}`;
  const base = resolveBlobBaseUrl(baseUrl);
  try {
    return new URL(normalizedPath, base).href;
  } catch {
    return normalizedPath;
  }
};

const uploadToBlobStore = async (filePath, mimeType, ctx = {}) => {
  const agentId = resolveAgentId(ctx.agentId);
  const baseUrl = resolveBlobBaseUrl(ctx.blobBaseUrl);
  const blobStoreUrl = new URL(`/blobs/${encodeURIComponent(agentId)}`, baseUrl).href;

  const fileName = path.basename(filePath);
  const fileBuffer = await fsp.readFile(filePath);
  const fileBlob = new Blob([fileBuffer], { type: mimeType });

  const headers = {
    "Content-Type": mimeType,
    "X-Mime-Type": mimeType,
    "X-File-Name": encodeURIComponent(fileName)
  };

  const response = await fetch(blobStoreUrl, {
    method: "POST",
    headers,
    body: fileBlob
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to upload to blob store: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json().catch(() => ({}));
  const localPath = typeof data.localPath === "string" ? data.localPath : null;
  const normalizedDownloadUrl = normalizeDownloadUrl(localPath, data.downloadUrl, baseUrl);

  return {
    id: data.id ?? null,
    agentId,
    filename: data.filename || fileName,
    localPath,
    downloadUrl: normalizedDownloadUrl,
    mime: data.mime ?? mimeType,
    size: data.size ?? fileBuffer.length
  };
};

const normalizeMediaList = (raw) => {
  const input = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const flat = [];
  const pushIfUrlish = (val) => {
    if (typeof val !== "string") return;
    const trimmed = val.trim();
    if (!trimmed) return;
    flat.push(trimmed);
  };

  for (const entry of input) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          flat.push(...parsed);
          continue;
        }
        if (parsed && typeof parsed === "object") {
          const candidate = parsed.path || parsed.downloadUrl || parsed.localPath || parsed.url || parsed.value;
          if (candidate) {
            flat.push(candidate);
            continue;
          }
          Object.keys(parsed).forEach((k) => pushIfUrlish(k));
          Object.values(parsed).forEach((v) => pushIfUrlish(typeof v === "string" ? v : ""));
          continue;
        }
      } catch (_) {
      }
      const urlMatches = trimmed.match(/https?:[^\\s"']+/g);
      if (urlMatches && urlMatches.length) {
        flat.push(...urlMatches);
        continue;
      }
      flat.push(trimmed);
      continue;
    }
    if (entry && typeof entry === "object") {
      const candidate = entry.id || entry.path || entry.downloadUrl || entry.localPath || entry.url || entry.value;
      if (candidate) {
        flat.push(String(candidate));
      }
      continue;
    }
    flat.push(String(entry));
  }
  return flat;
};

const downloadToFile = async (url, targetPath) => {
  const targetUrl = normalizeUrlForContainer(url);
  const doFetch = async (u) => {
    const res = await fetch(u);
    if (!res.ok) {
      throw new Error(`Failed to download ${u}: ${res.status} ${res.statusText}`);
    }
    const contentType = (res.headers?.get("content-type") || "").toLowerCase();
    if (contentType.includes("image/svg")) {
      throw new Error("SVG images are not supported; please convert to PNG/JPG.");
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fsp.writeFile(targetPath, buffer);
  };
  try {
    await doFetch(url);
  } catch (err) {
    await doFetch(targetUrl);
  }
  return targetPath;
};

const buildBlobUrlFromId = (id) => {
  const host = process.env.HOST_LOOPBACK || "host.docker.internal";
  const port = process.env.BLOB_PORT || process.env.PLOINKY_ROUTER_PORT || process.env.PORT || "8080";
  const agent = process.env.BLOB_AGENT || "explorer";
  return `http://${host}:${port}/blobs/${encodeURIComponent(agent)}/${encodeURIComponent(String(id).trim())}`;
};

const ensureLocalPath = async (src, workDir, tempDir, label) => {
  if (!src || typeof src !== "string") {
    throw new Error(`Missing ${label} path/URL`);
  }
  const isSvg = src.toLowerCase().endsWith(".svg");
  if (isSvg) {
    throw new Error("SVG images are not supported; please convert to PNG/JPG before using ffmpegImageToVideo.");
  }
  if (isHttp(src)) {
    const normalized = normalizeUrlForContainer(src);
    const fname = `${label}-${Date.now()}${path.extname(src) || ".bin"}`;
    const dest = path.join(tempDir, fname);
    await downloadToFile(normalized, dest);
    return dest;
  }
  const fname = `${label}-${Date.now()}.bin`;
  const dest = path.join(tempDir, fname);
  const blobUrl = buildBlobUrlFromId(src);
  await downloadToFile(blobUrl, dest);
  return dest;
};

const pickFfmpegBin = () => {
  const candidates = [
    process.env.FFMPEG_BIN,
    process.env.FFMPEG_PATH,
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg"
  ].filter(Boolean);

  for (const bin of candidates) {
    if (!fs.existsSync(bin)) continue;
    try {
      const st = fs.statSync(bin);
      if (!st.isFile()) continue;
    } catch (e) {
      continue;
    }
    try {
      fs.chmodSync(bin, "755");
    } catch (e) {
    }
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch (e) {
    }
  }
  return ffmpegStatic || "ffmpeg";
};

export default async function ffmpegImageToVideo(input, context = {}) {
  const payload = input && typeof input === "object" ? input : {};
  const images = normalizeMediaList(payload.images || payload.image || payload.value);
  if (!images.length) {
    throw new Error("ffmpegImageToVideo requires at least one image");
  }

  const workDir = process.cwd();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ffmpeg-image-to-video-"));
  const fps = toNumber(payload.fps, 25);
  const width = toNumber(payload.width, 1280);
  const height = toNumber(payload.height, 720);
  const duration = toNumber(payload.duration, 3);
  const background = payload.bg || payload.background || "black";
  const audio = payload.audio || null;

  try {
    const localImages = [];
    for (let index = 0; index < images.length; index += 1) {
      const localPath = await ensureLocalPath(images[index], workDir, tempDir, `image-${index}`);
      localImages.push(localPath);
    }

    const concatPath = path.join(tempDir, "images.txt");
    const concatContent = localImages.map((localPath) => `file '${localPath.replace(/'/g, "'\\''")}'\nduration ${duration}\n`).join("");
    await fsp.writeFile(concatPath, concatContent, "utf8");

    let audioPath = null;
    if (audio) {
      audioPath = await ensureLocalPath(audio, workDir, tempDir, "audio");
    }

    const outputPath = path.join(tempDir, "out.mp4");
    const ffmpegArgs = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatPath,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background}`,
      "-r", String(fps)
    ];

    if (audioPath) {
      ffmpegArgs.push("-i", audioPath, "-shortest");
    }

    ffmpegArgs.push(
      "-pix_fmt", "yuv420p",
      "-c:v", "libx264",
      outputPath
    );

    const ffmpegBin = pickFfmpegBin();
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegBin, ffmpegArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });

    const uploaded = await uploadToBlobStore(outputPath, "video/mp4", context || {});
    return {
      value: uploaded.downloadUrl || uploaded.localPath || uploaded.id || "",
      ...uploaded
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
