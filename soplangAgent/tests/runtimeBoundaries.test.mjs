import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { walkMarkdownFiles } from "../plugins/lib/workspaceRoots.mjs";

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const setTreeMode = async (target, { directoryMode, fileMode }) => {
    const stat = await fs.lstat(target);
    if (!stat.isDirectory()) {
        await fs.chmod(target, fileMode);
        return;
    }
    const entries = await fs.readdir(target);
    for (const entry of entries) {
        await setTreeMode(path.join(target, entry), { directoryMode, fileMode });
    }
    await fs.chmod(target, directoryMode);
};

const findUnexpectedLogs = async (target) => {
    const found = [];
    const walk = async (current) => {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) await walk(entryPath);
            else if (entry.name === "last-tool.log" || entry.name === "achilles-debug.log") found.push(entryPath);
        }
    };
    await walk(target);
    return found;
};

test("workspace scan result excludes .data and retains root .ploinky/repos", async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "soplang-scan-boundary-"));
    t.after(async () => fs.rm(root, { recursive: true, force: true }));
    const files = [
        path.join(root, "README.md"),
        path.join(root, ".data", "webAssist", "private.md"),
        path.join(root, ".ploinky", "repos", "demo", "public.md"),
    ];
    for (const file of files) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "# Document\n", "utf8");
    }

    const result = (await walkMarkdownFiles(root)).map((file) => path.relative(root, file)).sort();

    assert.deepEqual(result, [
        path.join(".ploinky", "repos", "demo", "public.md"),
        "README.md",
    ]);
});

test("soplang-tool.sh keeps launcher and debug logs in LOGS_FOLDER with read-only source and cwd", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "soplang-launcher-boundary-"));
    const source = path.join(root, "readonly-source");
    const cwd = path.join(root, "cwd");
    const logs = path.join(root, "logs");
    const persistence = path.join(root, "persistence");
    const audit = path.join(root, "audit");

    try {
        await fs.cp(AGENT_ROOT, source, { recursive: true });
        const achillesStub = path.join(source, "node_modules", "achillesAgentLib");
        await fs.mkdir(path.join(source, "node_modules", "soplang", "plugins"), { recursive: true });
        await fs.mkdir(achillesStub, { recursive: true });
        await fs.writeFile(path.join(achillesStub, "package.json"), JSON.stringify({
            name: "achillesAgentLib",
            type: "module",
            exports: "./index.mjs",
        }), "utf8");
        await fs.writeFile(path.join(achillesStub, "index.mjs"), [
            "export class MainAgent {",
            "    getSkills() { return []; }",
            "    async executeSkill() { return ''; }",
            "}",
            "",
        ].join("\n"), "utf8");
        await fs.mkdir(cwd, { recursive: true });
        await setTreeMode(source, { directoryMode: 0o555, fileMode: 0o555 });
        await fs.chmod(cwd, 0o555);

        const result = await new Promise((resolve, reject) => {
            const child = spawn(path.join(source, "soplang-tool.sh"), [], {
                cwd,
                env: {
                    ...process.env,
                    ACHILLES_DEBUG: "1",
                    TOOL_NAME: "execute_skill",
                    PERSISTENCE_FOLDER: persistence,
                    LOGS_FOLDER: logs,
                    AUDIT_FOLDER: audit,
                },
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => { stdout += String(chunk); });
            child.stderr.on("data", (chunk) => { stderr += String(chunk); });
            child.on("error", reject);
            child.on("close", (code) => resolve({ code, stdout, stderr }));
            child.stdin.end(JSON.stringify({ input: { skillName: "demo", promptText: "hello" } }));
        });

        assert.equal(result.code, 1);
        assert.match(await fs.readFile(path.join(logs, "last-tool.log"), "utf8"), /AchillesSkills/);
        assert.match(await fs.readFile(path.join(logs, "achilles-debug.log"), "utf8"), /Initializing AchillesSkills plugin/);
        assert.deepEqual(await findUnexpectedLogs(source), []);
        assert.deepEqual(await findUnexpectedLogs(cwd), []);
        assert.deepEqual((await fs.readdir(logs)).sort(), ["achilles-debug.log", "last-tool.log"]);
    } finally {
        await setTreeMode(source, { directoryMode: 0o755, fileMode: 0o644 }).catch(() => {});
        await fs.chmod(cwd, 0o755).catch(() => {});
        await fs.rm(root, { recursive: true, force: true });
    }
});
