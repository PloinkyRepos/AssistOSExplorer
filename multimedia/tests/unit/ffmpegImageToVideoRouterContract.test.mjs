import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRouterBlobCollectionUrl,
  buildRouterBlobUrl,
  resolveMediaSourceUrl,
  resolvePloinkyRouterUrl,
  resolveRouterDownloadUrl
} from "../../skills/ffmpegImageToVideo/src/routerBlobContract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("router blob operations fail closed without injected PLOINKY_ROUTER_URL", () => {
  assert.throws(
    () => resolvePloinkyRouterUrl({
      HOST_LOOPBACK: "host.docker.internal",
      FILE_EXPLORER_URL: "http://localhost:8080",
      BLOB_BASE_URL: "http://127.0.0.1:8080",
      ROUTER_URL: "http://legacy-router:8080"
    }),
    /PLOINKY_ROUTER_URL is required/,
  );
});

test("PLOINKY_ROUTER_URL must be an HTTP(S) origin", () => {
  for (const value of [
    "not a URL",
    "ftp://ploinky-router:8080",
    "http://user:secret@ploinky-router:8080",
    "http://ploinky-router:8080/blobs",
    "http://ploinky-router:8080?target=other",
    "http://ploinky-router:8080#fragment"
  ]) {
    assert.throws(
      () => resolvePloinkyRouterUrl({ PLOINKY_ROUTER_URL: value }),
      /valid HTTP\(S\) origin URL/,
      value,
    );
  }
});

test("router blob URLs use only the injected router origin and encode path segments", () => {
  const routerBaseUrl = resolvePloinkyRouterUrl({
    PLOINKY_ROUTER_URL: "http://ploinky-router:8080/"
  });

  assert.equal(routerBaseUrl, "http://ploinky-router:8080");
  assert.equal(
    buildRouterBlobCollectionUrl("media agent", routerBaseUrl),
    "http://ploinky-router:8080/blobs/media%20agent",
  );
  assert.equal(
    buildRouterBlobUrl("folder/blob 1", { agentId: "explorer", routerBaseUrl }),
    "http://ploinky-router:8080/blobs/explorer/folder%2Fblob%201",
  );
  assert.equal(
    resolveRouterDownloadUrl("blobs/explorer/result", "", routerBaseUrl),
    "http://ploinky-router:8080/blobs/explorer/result",
  );
});

test("explicit external HTTP(S) media and download URLs remain unchanged", () => {
  const options = {
    agentId: "explorer",
    routerBaseUrl: "http://ploinky-router:8080"
  };
  for (const url of [
    "http://localhost:9000/image.png?raw=1#frame",
    "http://127.0.0.1:9000/audio.mp3",
    "http://host.docker.internal:9000/video.mp4",
    "https://cdn.example.test/media/image.png?token=external"
  ]) {
    assert.equal(resolveMediaSourceUrl(url, options), url);
    assert.equal(resolveRouterDownloadUrl("ignored", url, options.routerBaseUrl), url);
  }
});

test("ffmpeg implementation contains no legacy host or alternate router fallback", () => {
  const implementation = fs.readFileSync(
    path.resolve(here, "../../skills/ffmpegImageToVideo/src/ffmpegImageToVideo.mjs"),
    "utf8",
  );

  assert.doesNotMatch(
    implementation,
    /HOST_LOOPBACK|FILE_EXPLORER_URL|BLOB_BASE_URL|BLOB_STORE_URL|ROUTER_URL|host\.docker\.internal/,
  );
  assert.match(implementation, /resolvePloinkyRouterUrl\(process\.env\)/);
});
