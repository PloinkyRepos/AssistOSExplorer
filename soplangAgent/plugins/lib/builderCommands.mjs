import fs from "node:fs/promises";
import path from "node:path";

export const registerAchillesCLISOPlangCommands = (workspace, {
    debug,
    pickWorkspaceRoot,
    fsModule = fs,
    pathModule = path,
    loadPlugin = () => undefined
} = {}) => {
    debug.log("[SoplangBuilder] Registering custom Achilles CLI SOPLang commands...");

    workspace.registerCommand("load", async (inputValues) => {
        const specRef = inputValues[0];
        if (!specRef || typeof specRef !== "string") {
            return undefined;
        }

        const [filePath, sectionId] = specRef.split("#");
        if (!filePath) {
            return undefined;
        }

        try {
            const root = await pickWorkspaceRoot();
            const fullPath = pathModule.isAbsolute(filePath)
                ? filePath
                : pathModule.join(root, ".specs", filePath);
            const content = await fsModule.readFile(fullPath, "utf8");

            if (sectionId) {
                const sectionRegex = new RegExp(`^##\\s+${sectionId}[\\s\\S]*?(?=^##\\s|$)`, "m");
                const match = content.match(sectionRegex);
                if (match) {
                    return match[0].trim();
                }

                const anchorRegex = new RegExp(`#${sectionId}[\\s\\S]*?(?=^#|$)`, "gm");
                const anchorMatch = content.match(anchorRegex);
                if (anchorMatch) {
                    return anchorMatch[0].trim();
                }
            }

            return content.trim();
        } catch (err) {
            console.warn(`load command failed for ${specRef}: ${err.message}`);
            return undefined;
        }
    });
    debug.log("[SoplangBuilder] ✓ Registered command: load");

    workspace.registerCommand("createJSCode", async (inputValues) => {
        const prompt = inputValues.join(" ");
        if (!prompt || !prompt.trim()) {
            return undefined;
        }

        try {
            const llm = loadPlugin("LLM");
            if (!llm || typeof llm.executePrompt !== "function") {
                console.warn("createJSCode: LLM plugin not available");
                return `// LLM not available - prompt was:\n// ${prompt.replace(/\n/g, "\n// ")}`;
            }

            const systemPrompt = "You are a code generator. Generate clean, modern JavaScript (ES modules, async/await) based on the specification provided. Output ONLY the code, no explanations or markdown fences.";
            const result = await llm.executePrompt(prompt, {
                systemPrompt,
                responseShape: "text"
            });

            return typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
            console.warn(`createJSCode command failed: ${err.message}`);
            return `// Code generation failed: ${err.message}\n// Prompt was:\n// ${prompt.replace(/\n/g, "\n// ")}`;
        }
    });
    debug.log("[SoplangBuilder] ✓ Registered command: createJSCode");

    workspace.registerCommand("store", async (inputValues) => {
        const filePath = inputValues[0];
        const content = inputValues.slice(1).join(" ");

        if (!filePath || typeof filePath !== "string") {
            console.warn("store command: missing file path");
            return undefined;
        }

        try {
            const root = await pickWorkspaceRoot();
            const fullPath = pathModule.isAbsolute(filePath)
                ? filePath
                : pathModule.join(root, filePath);
            const dir = pathModule.dirname(fullPath);
            await fsModule.mkdir(dir, { recursive: true });
            await fsModule.writeFile(fullPath, content || "", "utf8");
            return fullPath;
        } catch (err) {
            console.warn(`store command failed for ${filePath}: ${err.message}`);
            return undefined;
        }
    });
    debug.log("[SoplangBuilder] ✓ Registered command: store");
    debug.log("[SoplangBuilder] All custom SOPLang commands registered successfully");
};
