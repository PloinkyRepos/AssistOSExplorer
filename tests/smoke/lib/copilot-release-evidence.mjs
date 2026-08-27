import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  collectLiveBoxEvidence,
  sameLiveBoxGeneration,
} from './live-box.mjs';

const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;

export async function collectCopilotReleaseEvidence({
  manifestPath,
  verifierPath,
  baseURL,
  boxBaseURL = baseURL,
  expectedContainerName = '',
  expectedImageRef = '',
  generationMaxAgeMs,
  imageMaxAgeMs,
  loadVerifier = async (filePath) => import(pathToFileURL(filePath).href),
  collectLiveBox = collectLiveBoxEvidence,
  realpathSync = fs.realpathSync,
} = {}) {
  if (!manifestPath || !path.isAbsolute(manifestPath)) {
    throw new Error('SMOKE_RELEASE_MANIFEST must be an absolute path for the ordinary Copilot gate.');
  }
  if (!verifierPath || !path.isAbsolute(verifierPath)) {
    throw new Error('The ordinary Copilot gate requires an absolute release verifier path.');
  }
  const verifier = await loadVerifier(verifierPath);
  if (typeof verifier?.verifyManifestFile !== 'function') {
    throw new Error('The Copilot release verifier does not export verifyManifestFile.');
  }
  const verified = verifier.verifyManifestFile(manifestPath);
  if (!IMAGE_DIGEST.test(String(verified?.imageDigest || ''))) {
    throw new Error('The Copilot release verifier did not return an immutable Box image digest.');
  }
  const verifiedPloinky = verified?.repositories?.ploinky;
  if (!verifiedPloinky || !path.isAbsolute(String(verifiedPloinky.repositoryPath || ''))) {
    throw new Error('The Copilot release verifier did not return the verified Ploinky checkout path.');
  }
  const verifiedAgentLib = verified?.repositories?.achillesAgentLib;
  if (!verifiedAgentLib || !GIT_COMMIT.test(String(verifiedAgentLib.commit || ''))) {
    throw new Error('The Copilot release verifier did not return the verified achillesAgentLib commit.');
  }
  const verifiedPloinkySource = realpathSync(verifiedPloinky.repositoryPath);
  const liveBox = collectLiveBox({
    baseURL: boxBaseURL,
    expectedContainerName,
    expectedImageId: verified.imageDigest,
    expectedImageRef,
    generationMaxAgeMs,
    imageMaxAgeMs,
    requireFreshImage: false,
    expectedPloinkySource: verifiedPloinkySource,
    realpathSync,
  });
  if (liveBox?.box?.imageId !== verified.imageDigest) {
    throw new Error('The running Box image does not match SMOKE_RELEASE_MANIFEST.');
  }
  if (liveBox?.ploinkySourceMount?.source !== verifiedPloinkySource) {
    throw new Error('The running Box is not bound read-only to the verified Ploinky checkout.');
  }
  const liveAgentLib = liveBox?.box?.semanticLabels;
  if (liveAgentLib?.agentLibCommit !== verifiedAgentLib.commit) {
    throw new Error('The running Box AgentLib commit does not match SMOKE_RELEASE_MANIFEST.');
  }
  const agentLib = Object.freeze({
    mode: liveAgentLib.agentLibMode,
    sourceIdHash: liveAgentLib.agentLibSourceIdHash,
    fingerprint: liveAgentLib.agentLibFingerprint,
    sourceRelativePath: liveAgentLib.agentLibSourceRelativePath,
    commit: liveAgentLib.agentLibCommit,
  });
  return Object.freeze({
    applicationBaseURL: baseURL,
    boxBaseURL,
    imageDigest: verified.imageDigest,
    repositories: verified.repositories,
    ploinkySource: Object.freeze({
      path: verifiedPloinkySource,
      commit: verifiedPloinky.commit,
    }),
    agentLib,
    liveBox,
  });
}

export function sameCopilotReleaseGeneration(before, after) {
  return Boolean(
    before?.applicationBaseURL
    && before.applicationBaseURL === after?.applicationBaseURL
    && before?.boxBaseURL
    && before.boxBaseURL === after?.boxBaseURL
    && before?.imageDigest
    && before.imageDigest === after?.imageDigest
    && before.imageDigest === before?.liveBox?.box?.imageId
    && after.imageDigest === after?.liveBox?.box?.imageId
    && before?.ploinkySource?.path === after?.ploinkySource?.path
    && before?.ploinkySource?.commit === after?.ploinkySource?.commit
    && before?.agentLib?.commit
    && JSON.stringify(before?.agentLib) === JSON.stringify(after?.agentLib)
    && sameLiveBoxGeneration(before.liveBox, after.liveBox)
  );
}
