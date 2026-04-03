import debug from "../debugLogger.mjs";

export const createAchillesSkills = async ({
    workspace,
    AgentClass,
    startDir
} = {}) => {
    if (!workspace) {
        throw new Error("workspace is required");
    }
    if (!AgentClass) {
        throw new Error("AgentClass is required");
    }
    if (!startDir) {
        throw new Error("startDir is required");
    }

    let agent = null;
    const registered = new Set();

    const ensureAgent = async () => {
        if (agent) {
            return agent;
        }

        debug.log("[AchillesSkills] Initializing RecursiveSkilledAgent", {
            startDir,
            searchUpwards: false,
            workspaceRoot: process.env.PLOINKY_WORKSPACE_ROOT || "(not set)"
        });

        agent = new AgentClass({
            startDir,
            searchUpwards: false
        });

        if (Array.isArray(agent.pendingPreparations) && agent.pendingPreparations.length) {
            await Promise.allSettled(agent.pendingPreparations);
            agent.pendingPreparations = [];
        }

        return agent;
    };

    const registerSkills = async () => {
        await ensureAgent();
        const skills = Array.from(agent.skillCatalog.values());

        for (const record of skills) {
            const commandName = record.name;
            if (!commandName || registered.has(commandName)) {
                continue;
            }

            debug.log("[AchillesSkills] Registering command", {
                commandName,
                skillName: record.name,
                type: record.type,
                shortName: record.shortName || ""
            });

            workspace.registerCommand(commandName, async (inputValues, parsedCommand, currentDocId, graph, buildInstance, docPath) => {
                    await ensureAgent();
                    const promptText = Array.isArray(inputValues)
                        ? inputValues.join(" ")
                        : (typeof inputValues === "string" ? inputValues : "");
                    const out = await agent.executeWithReviewMode(promptText, {
                        skillName: record.name,
                        context: {
                            sopDocFilePath: docPath
                        }
                    }, "none");
                    if (out && typeof out === "object" && Object.prototype.hasOwnProperty.call(out, "result")) {
                        return out.result;
                    }
                    debug.log(`[AchillesSkills] ${commandName} executed, result: ${out}`);
                    return out;
                });

            registered.add(commandName);
        }

        debug.log("[AchillesSkills] Command registration complete", {
            skills: skills.length,
            commands: registered.size
        });
        return skills.length;
    };

    await registerSkills();

    return {
        async reload() {
            agent = null;
            registered.clear();
            return registerSkills();
        },

        async executeSkill(skillName, promptText = "") {
            if (!skillName || typeof skillName !== "string") {
                throw new Error("skillName is required");
            }

            const text = Array.isArray(promptText)
                ? promptText.join(" ")
                : (typeof promptText === "string" ? promptText : "");

            await registerSkills();
            await ensureAgent();
            const result = await agent.executeWithReviewMode(text, { skillName }, "none");
            if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "result")) {
                return result.result;
            }
            return result;
        }
    };
};
