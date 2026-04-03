import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { debug as defaultDebug } from "../debugLogger.mjs";
import { registerAchillesCLISOPlangCommands } from "./builderCommands.mjs";
import { parseDocsFromMarkdown } from "./markdownMetadata.mjs";
import { parseCommandsForUI } from "../../node_modules/soplang/src/util/soplangUtil.js";
import { pickWorkspaceRoot, walkMarkdownFiles } from "./workspaceRoots.mjs";

const parseMaybeJson = (value) => {
    if (typeof value !== "string") {
        return value;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return value;
    }

    try {
        return JSON.parse(trimmed);
    } catch (_) {
        return value;
    }
};

const STATE_FILE_NAME = "soplang-builder-state.json";

const hashTemplate = (template) => crypto
    .createHash("sha256")
    .update(JSON.stringify(template))
    .digest("hex");

const getStateFilePath = (pathModule = path, env = process.env) => {
    const storageRoot = env.PERSISTENCE_FOLDER || "/persistoStorage";
    return pathModule.join(storageRoot, STATE_FILE_NAME);
};

const loadBuilderState = async ({
    fsModule = fs,
    pathModule = path,
    env = process.env
} = {}) => {
    const filePath = getStateFilePath(pathModule, env);
    try {
        const raw = await fsModule.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return {
            documentHashes: parsed?.documentHashes && typeof parsed.documentHashes === "object" ? parsed.documentHashes : {},
            pendingDocuments: Array.isArray(parsed?.pendingDocuments) ? parsed.pendingDocuments : [],
            lastSyncedAt: parsed?.lastSyncedAt || null,
            lastBuiltAt: parsed?.lastBuiltAt || null,
            lastBuiltDocuments: Array.isArray(parsed?.lastBuiltDocuments) ? parsed.lastBuiltDocuments : []
        };
    } catch (_) {
        return {
            documentHashes: {},
            pendingDocuments: [],
            lastSyncedAt: null,
            lastBuiltAt: null,
            lastBuiltDocuments: []
        };
    }
};

const saveBuilderState = async (state, {
    fsModule = fs,
    pathModule = path,
    env = process.env
} = {}) => {
    const filePath = getStateFilePath(pathModule, env);
    await fsModule.mkdir(pathModule.dirname(filePath), { recursive: true });
    await fsModule.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
    return state;
};

const collectDocumentTemplates = async (files, {
    fsModule = fs,
    pathModule = path
} = {}) => {
    const docTemplates = {};

    for (const filePath of files) {
        let content = "";
        try {
            content = await fsModule.readFile(filePath, "utf8");
        } catch (err) {
            console.warn("Failed to read file", filePath, err.message);
            continue;
        }

        const parsedDocs = parseDocsFromMarkdown(content, filePath, { pathModule });
        Object.entries(parsedDocs).forEach(([docId, docData]) => {
            const id = docId || pathModule.basename(filePath, ".md");
            docTemplates[id] = docTemplates[id] || {
                ...docData,
                docId: docData.docId || id,
                docPath: pathModule.resolve(filePath),
                title: docData.title || id,
                category: docData.category || "category",
                commands: docData.commands || "",
                infoText: docData.infoText || "",
                comments: docData.comments || {}
            };
        });
    }

    return docTemplates;
};

const collectActiveVarsFromTemplates = (docTemplates) => {
    const activeByDoc = new Map();

    const addCommands = (docId, commands) => {
        if (!docId || !commands || !commands.trim()) {
            return;
        }
        const parsed = parseCommandsForUI(commands);
        if (!parsed.length) {
            return;
        }
        let set = activeByDoc.get(docId);
        if (!set) {
            set = new Set();
            activeByDoc.set(docId, set);
        }
        parsed.forEach((command) => {
            if (command?.varName) {
                set.add(command.varName);
            }
        });
    };

    Object.values(docTemplates).forEach((doc) => {
        addCommands(doc.docId, doc.commands);
        const chapters = Array.isArray(doc.chapters) ? doc.chapters : [];
        chapters.forEach((chapter) => {
            addCommands(doc.docId, chapter?.commands || "");
            const paragraphs = Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : [];
            paragraphs.forEach((paragraph) => {
                addCommands(doc.docId, paragraph?.commands || "");
            });
        });
    });

    return activeByDoc;
};

const resetExistingDocument = async (documents, docId, docTemplate) => {
    let docObj;
    try {
        docObj = await documents.getDocument(docId);
    } catch (_) {
        docObj = null;
    }

    if (!docObj) {
        docObj = await documents.createDocument(docId, "category");
        return docObj;
    }

    const existingChapters = Array.isArray(docObj.chapters) ? [...docObj.chapters] : [];
    for (const chapterId of existingChapters) {
        const chapter = await documents.getChapter(chapterId);
        const paragraphs = Array.isArray(chapter.paragraphs) ? [...chapter.paragraphs] : [];
        for (const paragraphId of paragraphs) {
            await documents.deleteParagraph(chapterId, paragraphId);
        }
        await documents.deleteChapter(docId, chapterId);
    }

    const category = docTemplate.category || "category";
    await documents.updateDocument(
        docId,
        docTemplate.title || docId,
        docId,
        category,
        docTemplate.infoText || "",
        docTemplate.commands || "",
        docTemplate.comments || {},
        docTemplate.docPath
    );

    return docObj;
};

const syncDocumentTemplates = async (documents, docTemplates) => {
    const created = [];
    const warnings = [];

    for (const [docId, docTemplate] of Object.entries(docTemplates)) {
        try {
            const docObj = await resetExistingDocument(documents, docId, docTemplate);
            await documents.applyTemplate(docObj.id, docTemplate);
            created.push(docId);
        } catch (err) {
            warnings.push(`Failed to process ${docId}: ${err.message}`);
        }
    }

    return { created, warnings };
};

const syncMarkdownDocuments = async ({
    resolveWorkspaceRoot,
    listMarkdownFiles,
    documents,
    fsModule,
    pathModule,
    env
}) => {
    const startedAt = Date.now();
    const root = await resolveWorkspaceRoot();
    const files = await listMarkdownFiles(root);

    if (!files.length) {
        throw new Error(`No markdown files found under ${root}`);
    }

    const docTemplates = await collectDocumentTemplates(files, {
        fsModule,
        pathModule
    });
    const currentHashes = Object.fromEntries(
        Object.entries(docTemplates).map(([docId, template]) => [docId, hashTemplate(template)])
    );
    const previousState = await loadBuilderState({ fsModule, pathModule, env });
    const changedDocuments = Object.keys(currentHashes).filter(
        (docId) => previousState.documentHashes[docId] !== currentHashes[docId]
    );
    const unchangedDocuments = Object.keys(currentHashes).filter(
        (docId) => previousState.documentHashes[docId] === currentHashes[docId]
    );

    const changedTemplates = Object.fromEntries(
        Object.entries(docTemplates).filter(([docId]) => changedDocuments.includes(docId))
    );
    const { created, warnings } = await syncDocumentTemplates(documents, changedTemplates);
    const syncedDocuments = [...created];
    const warningDocIds = new Set(
        warnings
            .map((warning) => /^Failed to process (.+?):/.exec(warning)?.[1])
            .filter(Boolean)
    );
    const successfullyChanged = changedDocuments.filter((docId) => !warningDocIds.has(docId));
    const nextHashes = Object.fromEntries(
        Object.entries(currentHashes).filter(([docId]) => !warningDocIds.has(docId))
    );
    const retainedPending = previousState.pendingDocuments.filter((docId) => !successfullyChanged.includes(docId));
    const pendingDocuments = Array.from(new Set([...retainedPending, ...successfullyChanged]));

    await saveBuilderState({
        documentHashes: nextHashes,
        pendingDocuments,
        lastSyncedAt: new Date().toISOString(),
        lastBuiltAt: previousState.lastBuiltAt,
        lastBuiltDocuments: previousState.lastBuiltDocuments
    }, { fsModule, pathModule, env });

    return {
        created: syncedDocuments,
        scanned: files.length,
        changedDocuments,
        unchangedDocuments,
        pendingDocuments,
        warnings,
        durationMs: Date.now() - startedAt
    };
};

export const getVariablesWithValues = async (workspace, {
    resolveWorkspaceRoot,
    listMarkdownFiles,
    fsModule = fs,
    pathModule = path
} = {}) => {
    let activeByDoc = null;
    if (resolveWorkspaceRoot && listMarkdownFiles) {
        try {
            const root = await resolveWorkspaceRoot();
            const files = await listMarkdownFiles(root);
            if (files.length) {
                const templates = await collectDocumentTemplates(files, { fsModule, pathModule });
                activeByDoc = collectActiveVarsFromTemplates(templates);
            }
        } catch (_) {
            activeByDoc = null;
        }
    }
    const vars = await workspace.getEveryVariableObject();
    const enriched = [];

    for (const variable of vars) {
        const entry = { ...variable };
        const varName = entry.varName || entry.name || entry.varId;
        const docId = entry.docId || entry.documentId;
        if (activeByDoc) {
            if (docId && varName) {
                const set = activeByDoc.get(docId);
                entry.isActive = Boolean(set && set.has(varName));
            } else {
                entry.isActive = true;
            }
        }
        if (!varName || !docId) {
            enriched.push(entry);
            continue;
        }

        try {
            const raw = await workspace.getVarValue(docId, varName);
            entry.value = parseMaybeJson(raw);
        } catch (err) {
            if (!entry.errorInfo) {
                entry.errorInfo = err?.message || String(err);
            }
        }
        enriched.push(entry);
    }

    return enriched;
};

export const createSoplangBuilder = ({
    workspace,
    documents,
    fsModule = fs,
    pathModule = path,
    debug = defaultDebug,
    env = process.env,
    cwd = () => process.cwd(),
    buildErrorsGetter = () => globalThis.$$?.getBuildErrors?.() || [],
    loadPlugin = (name) => globalThis.$$?.loadPlugin(name)
} = {}) => {
    if (!workspace) {
        throw new Error("workspace is required");
    }
    if (!documents) {
        throw new Error("documents is required");
    }

    const resolveWorkspaceRoot = () => pickWorkspaceRoot({
        fsModule,
        pathModule,
        env,
        cwd,
        logger: (message) => debug.log(message)
    });

    const listMarkdownFiles = async (root) => walkMarkdownFiles(root, {
        fsModule,
        pathModule
    });

    debug.log("[SoplangBuilder] ========== INITIALIZING ==========");
    debug.log("[SoplangBuilder] ACHILLES_DEBUG:", env.ACHILLES_DEBUG || "(not set)");
    debug.log("[SoplangBuilder] Loaded plugins: Workspace, Documents");

    registerAchillesCLISOPlangCommands(workspace, {
        debug,
        pickWorkspaceRoot: resolveWorkspaceRoot,
        fsModule,
        pathModule,
        loadPlugin
    });

    return {
        async syncMarkdownDocuments() {
            const result = await syncMarkdownDocuments({
                resolveWorkspaceRoot,
                listMarkdownFiles,
                documents,
                fsModule,
                pathModule,
                env
            });
            await workspace.forceSave();
            return {
                ...result,
                errors: []
            };
        },

        async executeWorkspaceBuild() {
            const startedAt = Date.now();
            await workspace.buildAll();
            const state = await loadBuilderState({ fsModule, pathModule, env });
            await saveBuilderState({
                ...state,
                pendingDocuments: [],
                lastBuiltAt: new Date().toISOString(),
                lastBuiltDocuments: Object.keys(state.documentHashes || {})
            }, { fsModule, pathModule, env });
            const errors = buildErrorsGetter().map((error) => {
                const message = error?.message || (() => {
                    try {
                        return JSON.stringify(error, null, 2);
                    } catch (_) {
                        return String(error);
                    }
                })();
                return { message };
            });
            return {
                errors,
                durationMs: Date.now() - startedAt
            };
        },

        async getVariablesWithValues() {
            return getVariablesWithValues(workspace, {
                resolveWorkspaceRoot,
                listMarkdownFiles,
                fsModule,
                pathModule
            });
        },

        async getVariableWithValue(documentId, varName) {
            if (!documentId || typeof documentId !== "string") {
                throw new Error("documentId is required");
            }
            if (!varName || typeof varName !== "string") {
                throw new Error("varName is required");
            }
            const variables = await workspace.getVariablesForDoc(documentId);
            const variable = variables.find((item) => item.varName === varName);
            return variable || null;
        },

        async getCommands() {
            return workspace.listCommands();
        },

        async getCustomTypes() {
            return workspace.getCustomTypes();
        }
    };
};
