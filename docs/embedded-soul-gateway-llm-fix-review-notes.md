# Embedded Soul Gateway LLM Fix Review Notes

## Purpose

This document is a handoff for reviewing the current embedded Soul Gateway and Explorer helper-agent changes. It records the production-like failure that was observed, the root causes found during inspection, the concrete files changed, the runtime invariants that matter, and the checks already run.

The issue was discovered after a clean Explorer deployment in `~/work/testExplorerFresh`. The Git modal failed while generating a commit message with:

```text
OpenAI API Error (401): {"error":{"message":"Invalid API key","type":"invalid_api_key"}}
```

The deployment was intended to use the embedded Soul Gateway sibling agent, but the failing helper call was still reaching the standalone production Soul Gateway endpoint with the embedded workspace-generated API key.

## Runtime Context

Explorer is deployed through Ploinky. In embedded mode:

- `proxies/soul-gateway` runs as an Explorer dependency.
- Explorer helper agents call Soul Gateway through the Ploinky router service route.
- Helper agents authenticate to Soul Gateway with a deterministic workspace-generated `SOUL_GATEWAY_API_KEY`.
- Soul Gateway bootstraps a default local LLM provider from `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`, `LOCAL_LLM_API_KEY`, and `LOCAL_LLM_ALIASES`.
- Request-time LLM calls must continue to go through `achillesAgentLib`; helper agents must not call vendor or local LLM endpoints directly.

Relevant contracts:

- `../../proxies/soul-gateway/docs/specs/DS016-embedded-mode.md`
- `../../proxies/soul-gateway/docs/specs/DS013-configuration-deployment.md`
- `../llmAssistant/docs/specs/DS06-ploinky-runtime-invariants.md`
- `../gitAgent/docs/specs/DS07-ploinky-runtime-invariants.md`
- `../webAssist/docs/specs/DS012-ploinky-runtime-invariants.md`

## Problems Found

### 1. Embedded key was sent to the standalone Soul Gateway

The live `llmAssistant` container in the scratch deployment had an embedded generated `SOUL_GATEWAY_API_KEY`, but also had:

```text
SOUL_GATEWAY_BASE_URL=https://soul.axiologic.dev
```

That base URL came from the workspace environment. Before the source metadata fix, `SOUL_GATEWAY_BASE_URL` had higher priority than router auto-discovery in `achillesAgentLib`, so the helper agent sent the embedded generated key to the standalone production Soul Gateway. Production correctly rejected it with `401 Invalid API key`.

Expected embedded behavior:

```text
SOUL_GATEWAY_BASE_URL=
PLOINKY_ROUTER_URL=http://host.containers.internal:<router-port>
```

With source metadata marking the key as generated, `achillesAgentLib` derives:

```text
${PLOINKY_ROUTER_URL}/services/soul-gateway/v1/chat/completions
```

### 2. Git helper calls used the wrong Achilles option name

The commit-message and conflict-resolution helpers used:

```js
agent.executePrompt(prompt, { mode: 'fast', responseShape: 'text' })
```

`LLMAgent.executePrompt()` expects `model`, not `mode`. Because `mode` was ignored, Achilles fell back to its default model selection. In this deployment that could resolve to `plan`, which was not previously registered as an embedded local-model alias.

Correct shape:

```js
agent.executePrompt(prompt, { model: 'fast', responseShape: 'text' })
```

### 3. Embedded Soul Gateway aliases were too narrow

Soul Gateway's embedded local LLM bootstrap previously mapped only:

```text
fast,axl/fast
```

That works for explicit `model: 'fast'`, but it does not cover legacy Achilles defaults such as `plan`, `code`, `write`, `deep`, and `ultra`. A helper that omits `model`, or any older workflow still using defaults, can fail with a missing model even when the local LLM provider is bootstrapped correctly.

The default alias set is now:

```text
fast,axl/fast,plan,code,write,deep,ultra
```

### 4. webAssist and webAdmin needed the same embedded routing protection

`webAssist` and `webAdmin` also use Achilles LLM helpers in Explorer-adjacent workflows. If they inherit a standalone `SOUL_GATEWAY_BASE_URL`, they can hit the same split-brain behavior: embedded key, standalone endpoint.

The `webAssist` manifest now has an `embedded` profile with the same generated key and empty base URL behavior as `llmAssistant` and `gitAgent`.

### 5. Manual scratch deployments still need the upstream local LLM secret

The default embedded local LLM endpoint is:

```text
https://lmstudio.axiologic.dev/v1
```

That endpoint requires a bearer token. The deploy workflow already maps `LMSTUDIO_PROXY_TOKEN` or `LOCAL_LLM_API_KEY` into Ploinky as `LOCAL_LLM_API_KEY`, but a manual scratch deployment needs the variable set explicitly:

```bash
ploinky var LOCAL_LLM_API_KEY "$LMSTUDIO_PROXY_TOKEN"
```

This secret must not be committed to manifests, docs examples with real values, logs, screenshots, or plugin assets.

## Files Changed

### AssistOSExplorer

`explorer/manifest.json`

- Enables `gitAgent global` with `profile: "embedded"`.
- Enables `llmAssistant global` with `profile: "embedded"`.
- Enables `webAssist` with `profile: "embedded"`.
- Keeps `proxies/soul-gateway` enabled with `profile: "embedded"`.

`llmAssistant/manifest.json`

- Converts the default env declaration to object form with optional entries.
- Adds an `embedded` profile that:
  - generates `SOUL_GATEWAY_API_KEY` through the shared generated-secret model;
  - sets `SOUL_GATEWAY_BASE_URL` to an empty string so Achilles uses router auto-discovery.

`gitAgent/manifest.json`

- Mirrors the `llmAssistant` embedded Soul Gateway profile.
- Keeps existing Git runtime env entries optional in the default profile.

`webAssist/manifest.json`

- Adds an `embedded` profile with the same generated Soul Gateway key and empty base URL behavior.

`llmAssistant/lib/git-commit-message.js`

- Changes `mode: 'fast'` to `model: 'fast'`.

`gitAgent/lib/git-commit-message.js`

- Changes `mode: 'fast'` to `model: 'fast'`.

`llmAssistant/lib/git-resolve-conflict.js`

- Changes `mode: 'fast'` to `model: 'fast'`.

`gitAgent/lib/git-resolve-conflict.js`

- Changes `mode: 'fast'` to `model: 'fast'`.

`llmAssistant/tools/llm_tool.mjs`

- Changes autocomplete LLM calls from `mode: 'fast'` to `model: 'fast'`.

Documentation updated:

- `docs/deploy-skills-explorer.md`
- `../llmAssistant/docs/configuration.html`
- `../gitAgent/docs/configuration.html`
- `../llmAssistant/docs/specs/DS02-Architecture.md`
- `../gitAgent/docs/specs/DS02-Architecture.md`
- `../llmAssistant/docs/specs/DS06-ploinky-runtime-invariants.md`
- `../gitAgent/docs/specs/DS07-ploinky-runtime-invariants.md`
- `../webAssist/docs/specs/DS012-ploinky-runtime-invariants.md`
- `../webAssist/docs/index.html`

### proxies/soul-gateway

`soul-gateway/manifest.json`

- Expands embedded `LOCAL_LLM_ALIASES` default to:

```text
fast,axl/fast,plan,code,write,deep,ultra
```

`soul-gateway/src/config/env.mjs`

- Updates the application default for `LOCAL_LLM_ALIASES` to match the manifest.

`soul-gateway/src/test/unit/config.test.mjs`

- Adds coverage for the expanded alias default.

`soul-gateway/src/test/unit/local-llm-bootstrap.test.mjs`

- Updates expected aliases in bootstrap tests.
- Keeps coverage for alias override behavior.

Documentation updated:

- `soul-gateway/docs/specs/DS016-embedded-mode.md`
- `soul-gateway/docs/specs/DS013-configuration-deployment.md`

## Important Implementation Details

### Why the manifests use an empty base URL

`achillesAgentLib` resolves Soul Gateway URL in this order:

1. `SOUL_GATEWAY_BASE_URL`
2. `SOUL_GATEWAY_URL`
3. `${PLOINKY_ROUTER_URL}/services/soul-gateway/v1`

The embedded profile sets `SOUL_GATEWAY_BASE_URL` to `""`. Ploinky appends simple object env values after normal secret and `.env` resolution, so this intentionally clears inherited standalone values from `.env` or encrypted Ploinky vars.

Do not replace this with a hardcoded router URL such as:

```text
http://host.containers.internal:8080/services/soul-gateway/v1
```

The router port differs between local and deployed workspaces. `PLOINKY_ROUTER_URL` is the stable runtime source of truth.

### Why default env declarations were converted to objects

The embedded profile needs to override `SOUL_GATEWAY_BASE_URL` with an empty value. Keeping the default env declaration as an array can interact poorly with mixed-format profile merging and make the override easier to lose. Object env form makes the default and embedded profiles merge predictably.

### Why aliases include Achilles default model names

Even after the direct `mode` to `model` fixes, older code paths or user workflows may still omit a model. The expanded aliases make the embedded local LLM provider tolerant of Achilles default names without requiring user-visible model configuration.

### Why `LOCAL_LLM_API_KEY` is not in helper-agent manifests

`LOCAL_LLM_API_KEY` belongs to the embedded Soul Gateway provider bootstrap, not to Explorer helper agents. Helper agents authenticate only to Soul Gateway with the generated workspace key. The upstream local LLM token is stored by Soul Gateway as an encrypted provider account when configured.

## Runtime Invariants To Preserve During Review

- Do not inject `PLOINKY_MASTER_KEY` into agent runtimes.
- Do not add direct LLM HTTP calls from Explorer helper agents.
- Do not hardcode Soul Gateway service routes in Ploinky core.
- Do not hardcode production-only URLs in embedded helper-agent manifests.
- Do not commit actual API keys, LM Studio proxy tokens, JWTs, session cookies, prompts, screenshots, or DOM dumps.
- Do not remove standalone compatibility. Existing standalone Soul Gateway deployments must continue to use explicit API keys and standalone base URLs.
- Keep embedded management auth router-protected, and keep inference auth at the Soul Gateway API-key layer.

## Checks Already Run

### Syntax and manifest validation

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer
node --check llmAssistant/lib/git-commit-message.js
node --check gitAgent/lib/git-commit-message.js
node --check llmAssistant/lib/git-resolve-conflict.js
node --check gitAgent/lib/git-resolve-conflict.js
node --check llmAssistant/tools/llm_tool.mjs
node --check webAssist/src/WebAssistAgent.mjs
node --check webAssist/webAdmin/src/WebAdminAgent.mjs
node -e "const fs=require('fs'); for (const f of ['llmAssistant/manifest.json','gitAgent/manifest.json','webAssist/manifest.json','explorer/manifest.json']) JSON.parse(fs.readFileSync(f,'utf8')); console.log('manifest json ok')"
```

Observed:

```text
manifest json ok
```

```bash
cd /Users/danielsava/work/file-parser/proxies/soul-gateway
node --check src/config/env.mjs
node --check src/bootstrap/local-llm-bootstrap.mjs
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('soul manifest json ok')"
```

Observed:

```text
soul manifest json ok
```

### Unit tests

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/gitAgent
node --test tests/unit/*.test.mjs
```

Observed:

```text
tests 37
pass 37
fail 0
```

```bash
cd /Users/danielsava/work/file-parser/proxies/soul-gateway
node --test src/test/unit/config.test.mjs src/test/unit/local-llm-bootstrap.test.mjs
```

Observed:

```text
tests 18
pass 18
fail 0
```

### Embedded profile merge probe

```bash
cd /Users/danielsava/work/file-parser/ploinky
node --input-type=module <<'NODE'
import fs from 'fs';
import { mergeProfiles } from './cli/services/profileService.js';
const files = [
  ['llmAssistant', '../AssistOSExplorer/llmAssistant/manifest.json'],
  ['gitAgent', '../AssistOSExplorer/gitAgent/manifest.json'],
  ['webAssist', '../AssistOSExplorer/webAssist/manifest.json'],
];
for (const [name, file] of files) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const merged = mergeProfiles(manifest.profiles.default, manifest.profiles.embedded);
  const env = merged.env || {};
  console.log(`${name}:baseUrlEmpty=${env.SOUL_GATEWAY_BASE_URL === ''};keyShared=${env.SOUL_GATEWAY_API_KEY?.sharedGeneratedSecret === true}`);
}
NODE
```

Observed:

```text
llmAssistant:baseUrlEmpty=true;keyDerived=true;deriveTarget=proxies/soul-gateway/workspace-default-api-key
gitAgent:baseUrlEmpty=true;keyDerived=true;deriveTarget=proxies/soul-gateway/workspace-default-api-key
webAssist:baseUrlEmpty=true;keyDerived=true;deriveTarget=proxies/soul-gateway/workspace-default-api-key
```

### Achilles router fallback probe

```bash
cd /Users/danielsava/work/file-parser/ploinky
SOUL_GATEWAY_API_KEY=placeholder SOUL_GATEWAY_BASE_URL= PLOINKY_ROUTER_URL=http://host.containers.internal:8097 node --input-type=module <<'NODE'
import { loadEnvConfig } from './node_modules/achillesAgentLib/utils/LLMProviders/providers/envConfigLoader.mjs';
const provider = loadEnvConfig().providers.get('soul_gateway');
console.log(provider?.baseURL || 'missing');
NODE
```

Observed:

```text
http://host.containers.internal:8097/services/soul-gateway/v1/chat/completions
```

### Diff hygiene

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer
git diff --check
```

Observed: no output, exit code 0.

```bash
cd /Users/danielsava/work/file-parser/proxies
git diff --check
```

Observed: no output, exit code 0.

## Known Limitations And Follow-Up Checks

### webAssist local test suite did not run in this checkout

Command:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/webAssist
node tests/runAll.mjs
```

Observed:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'achillesAgentLib'
```

This appears to be a local test-harness dependency resolution issue, not a runtime syntax failure. The touched webAssist files passed `node --check`. A reviewer should still run the webAssist suite inside the intended Ploinky or agent test environment if available.

### End-to-end clean deployment still needs to be repeated

The next high-confidence check is:

1. Destroy `~/work/testExplorerFresh`.
2. Remove the workspace contents.
3. Deploy Explorer from the target branch.
4. Ensure `LOCAL_LLM_API_KEY` is set for the default RAAS LM Studio endpoint.
5. Confirm Soul Gateway embedded health.
6. Confirm the Soul Gateway Settings plugin loads.
7. Trigger Git commit-message generation.
8. Confirm no request goes to `https://soul.axiologic.dev` unless explicitly configured for standalone mode.

Suggested runtime inspection commands:

```bash
cd ~/work/testExplorerFresh
ploinky status
podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
podman inspect <llmAssistant-container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SOUL_GATEWAY|PLOINKY_ROUTER_URL'
podman inspect <gitAgent-container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SOUL_GATEWAY|PLOINKY_ROUTER_URL'
podman inspect <webAssist-container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SOUL_GATEWAY|PLOINKY_ROUTER_URL'
```

Expected helper-agent environment shape:

```text
SOUL_GATEWAY_API_KEY=<present>
SOUL_GATEWAY_BASE_URL=
PLOINKY_ROUTER_URL=http://host.containers.internal:<router-port>
```

Do not print the actual API key value in logs or review notes.

## Reviewer Checklist

- Confirm `explorer/manifest.json` starts all Soul-consuming helper agents with `profile: "embedded"`.
- Confirm the helper-agent embedded profiles derive the key from `proxies/soul-gateway/workspace-default-api-key`.
- Confirm the helper-agent embedded profiles clear `SOUL_GATEWAY_BASE_URL`.
- Confirm no helper-agent code uses `mode: 'fast'` for `LLMAgent.executePrompt()`.
- Confirm Soul Gateway manifest and runtime defaults agree on `LOCAL_LLM_ALIASES`.
- Confirm standalone Soul Gateway behavior remains unchanged outside `SOUL_GATEWAY_MODE=embedded`.
- Confirm docs and specs describe both the automatic embedded behavior and the manual local `LOCAL_LLM_API_KEY` requirement.
- Confirm no secrets or real tokens were added to tracked files.

## Expected Outcome

After these changes, a clean embedded Explorer deployment should route Git commit-message generation and related helper-agent LLM calls through:

```text
helper agent -> achillesAgentLib -> Ploinky router -> embedded Soul Gateway -> configured local LLM provider
```

It should no longer send an embedded workspace-generated key to the standalone production Soul Gateway unless the operator explicitly chooses standalone configuration for that agent.
