import path from "node:path";
import { fileURLToPath } from "node:url";
import { RecursiveSkilledAgent } from "achillesAgentLib";
import { createAchillesSkills } from "./lib/achillesSkillsCore.mjs";
import debug from "./debugLogger.mjs";

async function AchillesSkills() {
    debug.log("[AchillesSkills] Initializing AchillesSkills plugin", {});
    const workspace = $$.loadPlugin("Workspace");
    const pluginDir = path.dirname(fileURLToPath(import.meta.url));
    const startDir = process.env.PLOINKY_WORKSPACE_ROOT
        ? path.resolve(process.env.PLOINKY_WORKSPACE_ROOT)
        : path.resolve(pluginDir, "..");
    return createAchillesSkills({
        workspace,
        AgentClass: RecursiveSkilledAgent,
        startDir
    });
}

let singleton = undefined;

export async function getInstance() {
    if (!singleton) {
        singleton = await AchillesSkills();
    }
    return singleton;
}

export function getAllow() {
    return async function () {
        return true;
    };
}

export function getDependencies() {
    return ["Workspace"];
}
