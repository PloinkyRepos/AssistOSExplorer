import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createSoplangBuilder, getVariablesWithValues } from "../plugins/lib/soplangBuilderCore.mjs";
import { createAchillesSkills } from "../plugins/lib/achillesSkillsCore.mjs";
import { deriveInvocation } from "../plugins/lib/toolInvocation.mjs";
import { walkMarkdownFiles } from "../plugins/lib/workspaceRoots.mjs";

const makeTempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), "soplang-builder-"));

const createWorkspaceStub = () => {
    const commands = new Map();
    return {
        commands,
        registerCommand(name, handler) {
            commands.set(name, handler);
        },
        async forceSave() {
            this.forceSaveCalls = (this.forceSaveCalls || 0) + 1;
        },
        async buildAll() {
            this.buildAllCalls = (this.buildAllCalls || 0) + 1;
            return { ok: true };
        },
        async buildOnlyForDocument(docId) {
            this.buildOnlyForDocumentCalls = this.buildOnlyForDocumentCalls || [];
            this.buildOnlyForDocumentCalls.push(docId);
            return { ok: true, docId };
        },
        async getEveryVariableObject() {
            return [];
        },
        async getVarValue() {
            return undefined;
        }
    };
};

test("syncMarkdownDocuments parses achilles markers and syncs documents", async () => {
    const root = await makeTempDir();
    const storageRoot = path.join(root, "persist");
    const markdownPath = path.join(root, "guide.md");
    await fs.writeFile(markdownPath, [
        '<!--{"achilles-ide-document":{"id":"guide","title":"Guide","infoText":"Info","commands":"@set doc_owner \\"alice\\""}}-->',
        '<!--{"achilles-ide-chapter":{"title":"Intro"}}-->',
        '<!--{"achilles-ide-paragraph":{"text":"Hello world","commands":"@set paragraph_var \\"x\\""}}-->'
    ].join("\n"), "utf8");

    const workspace = createWorkspaceStub();
    const applied = [];
    const documents = {
        async getDocument() {
            return null;
        },
        async createDocument(id, category) {
            return { id, category, chapters: [] };
        },
        async applyTemplate(id, template) {
            applied.push({ id, template });
        }
    };

    const builder = createSoplangBuilder({
        workspace,
        documents,
        env: { SOPLANG_WORKSPACE_ROOT: root, PERSISTENCE_FOLDER: storageRoot },
        cwd: () => root,
        buildErrorsGetter: () => []
    });

    const result = await builder.syncMarkdownDocuments();

    assert.equal(result.created[0], "guide");
    assert.equal(result.scanned, 1);
    assert.deepEqual(result.changedDocuments, ["guide"]);
    assert.deepEqual(result.pendingDocuments, ["guide"]);
    assert.equal(workspace.forceSaveCalls, 1);
    assert.equal(workspace.buildAllCalls || 0, 0);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].template.docId, "guide");
    assert.equal(applied[0].template.commands, '@set doc_owner "alice"');
    assert.equal(applied[0].template.chapters[0].paragraphs[0].commands, '@set paragraph_var "x"');
});

test("syncMarkdownDocuments skips unchanged documents", async () => {
    const root = await makeTempDir();
    const storageRoot = path.join(root, "persist");
    const markdownPath = path.join(root, ".ploinky", "repos", "demoRepo", "README.md");
    await fs.mkdir(path.dirname(markdownPath), { recursive: true });
    await fs.writeFile(markdownPath, [
        '<!--{"achilles-ide-document":{"id":"demo","title":"Demo","commands":"@set demo_var \\"ok\\""}}-->',
        '<!--{"achilles-ide-chapter":{"title":"Intro"}}-->',
        '<!--{"achilles-ide-paragraph":{"text":"Hello"}}-->'
    ].join("\n"), "utf8");

    const workspace = createWorkspaceStub();
    const applied = [];
    const documents = {
        async getDocument() {
            return null;
        },
        async createDocument(id, category) {
            return { id, category, chapters: [] };
        },
        async applyTemplate(id, template) {
            applied.push({ id, template });
        }
    };

    const builder = createSoplangBuilder({
        workspace,
        documents,
        env: { PLOINKY_CWD: root, PERSISTENCE_FOLDER: storageRoot },
        cwd: () => path.join(root, "code"),
        buildErrorsGetter: () => []
    });

    const firstSync = await builder.syncMarkdownDocuments();
    const secondSync = await builder.syncMarkdownDocuments();

    assert.deepEqual(firstSync.changedDocuments, ["demo"]);
    assert.deepEqual(secondSync.changedDocuments, []);
    assert.deepEqual(firstSync.pendingDocuments, ["demo"]);
    assert.deepEqual(secondSync.pendingDocuments, ["demo"]);
    assert.equal(applied.length, 1);
});

test("walkMarkdownFiles scans root .ploinky repos once and ignores nested .ploinky loops", async () => {
    const root = await makeTempDir();
    const workspaceDoc = path.join(root, ".ploinky", "repos", "demoRepo", "README.md");
    const nestedMarkerDir = path.join(root, ".ploinky", "repos", "fileExplorer", ".ploinky");
    const nestedExplorerMarkerDir = path.join(root, ".ploinky", "repos", "fileExplorer", "explorer", ".ploinky");
    const nestedDoc = path.join(root, ".ploinky", "repos", "fileExplorer", "explorer", "guide.md");

    await fs.mkdir(path.dirname(workspaceDoc), { recursive: true });
    await fs.mkdir(nestedMarkerDir, { recursive: true });
    await fs.mkdir(nestedExplorerMarkerDir, { recursive: true });
    await fs.mkdir(path.dirname(nestedDoc), { recursive: true });
    await fs.writeFile(workspaceDoc, "# demo\n", "utf8");
    await fs.writeFile(nestedDoc, "# guide\n", "utf8");

    const files = await walkMarkdownFiles(root);

    assert.deepEqual(
        files.map((file) => path.relative(root, file)).sort(),
        [
            path.join(".ploinky", "repos", "demoRepo", "README.md"),
            path.join(".ploinky", "repos", "fileExplorer", "explorer", "guide.md")
        ]
    );
});

test("executeWorkspaceBuild runs workspace.buildAll separately", async () => {
    const root = await makeTempDir();
    const workspace = createWorkspaceStub();
    const builder = createSoplangBuilder({
        workspace,
        documents: {
            async getDocument() {
                return null;
            },
            async createDocument(id, category) {
                return { id, category, chapters: [] };
            },
            async applyTemplate() {}
        },
        env: { PERSISTENCE_FOLDER: path.join(root, "persist") },
        buildErrorsGetter: () => []
    });

    const result = await builder.executeWorkspaceBuild();

    assert.equal(workspace.buildAllCalls, 1);
    assert.deepEqual(result.errors, []);
});

test("getVariablesWithValues enriches values and preserves errors", async () => {
    const workspace = {
        async getEveryVariableObject() {
            return [
                { varName: "settings", docId: "doc-1" },
                { varName: "broken", docId: "doc-1" },
                { name: "plain", documentId: "doc-2" },
                { misc: true }
            ];
        },
        async getVarValue(docId, varName) {
            if (varName === "settings") {
                return '{"enabled":true}';
            }
            if (varName === "plain") {
                return "hello";
            }
            throw new Error(`${docId}/${varName} failed`);
        }
    };

    const result = await getVariablesWithValues(workspace);

    assert.deepEqual(result[0].value, { enabled: true });
    assert.equal(result[1].errorInfo, "doc-1/broken failed");
    assert.equal(result[2].value, "hello");
    assert.deepEqual(result[3], { misc: true });
});

test("executeSkill forwards payload through the Achilles bridge", async () => {
    const registeredCommands = new Map();
    const workspace = {
        registerCommand(name, handler) {
            registeredCommands.set(name, handler);
        }
    };

    class FakeAgent {
        constructor() {
            this.pendingPreparations = [Promise.resolve()];
            this.skillCatalog = new Map([
                ["demo", { name: "demo", shortName: "d", type: "code" }]
            ]);
            this.calls = [];
            FakeAgent.instance = this;
        }

        async executePrompt(promptText, payload) {
            this.calls.push({ promptText, payload });
            return { result: { ok: true, payload } };
        }
    }

    const bridge = await createAchillesSkills({
        workspace,
        AgentClass: FakeAgent,
        startDir: "/tmp"
    });

    const result = await bridge.executeSkill("demo", "alpha 1");

    assert.equal(registeredCommands.has("demo"), true);
    assert.equal(registeredCommands.has("d"), false);
    assert.deepEqual(result, {
        ok: true,
        payload: {
            skillName: "demo"
        }
    });
    assert.deepEqual(FakeAgent.instance.calls[0], {
        promptText: "alpha 1",
        payload: {
            skillName: "demo"
        }
    });
});

test("deriveInvocation maps MCP tools to plugin methods", async () => {
    assert.deepEqual(deriveInvocation("sync_markdown_documents"), {
        pluginName: "SoplangBuilder",
        methodName: "syncMarkdownDocuments",
        params: []
    });
    assert.deepEqual(deriveInvocation("execute_workspace_build"), {
        pluginName: "SoplangBuilder",
        methodName: "executeWorkspaceBuild",
        params: []
    });
    assert.deepEqual(deriveInvocation("get_variables_with_values"), {
        pluginName: "SoplangBuilder",
        methodName: "getVariablesWithValues",
        params: []
    });
    assert.deepEqual(deriveInvocation("get_commands"), {
        pluginName: "SoplangBuilder",
        methodName: "getCommands",
        params: []
    });
    assert.deepEqual(deriveInvocation("get_types"), {
        pluginName: "SoplangBuilder",
        methodName: "getCustomTypes",
        params: []
    });
    assert.deepEqual(deriveInvocation("execute_skill", { skillName: "demo", promptText: "alpha 1" }), {
        pluginName: "AchillesSkills",
        methodName: "executeSkill",
        params: ["demo", "alpha 1"]
    });
});

test("deriveInvocation rejects unsupported tools", async () => {
    assert.throws(() => deriveInvocation("execute_incremental_build"), /Unsupported tool "execute_incremental_build"/);
    assert.throws(() => deriveInvocation("build_from_specs_markdown"), /Unsupported tool "build_from_specs_markdown"/);
    assert.throws(() => deriveInvocation("unknown_tool"), /Unsupported tool "unknown_tool"/);
});

test("soplang-tool.sh fails fast when TOOL_NAME is missing", async () => {
    const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "soplang-tool.sh");
    const result = await new Promise((resolve) => {
        const child = spawn("sh", [scriptPath], {
            cwd: path.resolve("."),
            env: { ...process.env }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify({ input: {} }));
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /TOOL_NAME is not set/);
});

test("pickWorkspaceRoot fails fast for invalid SOPLANG_WORKSPACE_ROOT", async () => {
    const workspace = createWorkspaceStub();
    const documents = {
        async getDocument() {
            return null;
        },
        async createDocument(id, category) {
            return { id, category, chapters: [] };
        },
        async applyTemplate() {}
    };

    const builder = createSoplangBuilder({
        workspace,
        documents,
        env: { SOPLANG_WORKSPACE_ROOT: "/definitely/missing/root" },
        cwd: () => process.cwd(),
        buildErrorsGetter: () => []
    });

    await assert.rejects(() => builder.syncMarkdownDocuments(), /SOPLANG_WORKSPACE_ROOT is set but invalid/);
});

test("syncMarkdownDocuments prefers PLOINKY_CWD and scans .ploinky/repos markdown", async () => {
    const root = await makeTempDir();
    const storageRoot = path.join(root, "persist");
    const repoDir = path.join(root, ".ploinky", "repos", "demoRepo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "README.md"), [
        '<!--{"achilles-ide-document":{"id":"demo","title":"Demo","commands":"@set demo_var \\"ok\\""}}-->',
        '<!--{"achilles-ide-chapter":{"title":"Intro"}}-->',
        '<!--{"achilles-ide-paragraph":{"text":"Hello"}}-->'
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, "README.md"), "# Agent code readme\n", "utf8");

    const workspace = createWorkspaceStub();
    const applied = [];
    const documents = {
        async getDocument() {
            return null;
        },
        async createDocument(id, category) {
            return { id, category, chapters: [] };
        },
        async applyTemplate(id, template) {
            applied.push({ id, template });
        }
    };

    const builder = createSoplangBuilder({
        workspace,
        documents,
        env: { PLOINKY_CWD: root, PERSISTENCE_FOLDER: storageRoot },
        cwd: () => path.join(root, "code"),
        buildErrorsGetter: () => []
    });

    const result = await builder.syncMarkdownDocuments();

    assert.equal(result.scanned, 2);
    assert.deepEqual(result.created, ["demo"]);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].template.docId, "demo");
});
