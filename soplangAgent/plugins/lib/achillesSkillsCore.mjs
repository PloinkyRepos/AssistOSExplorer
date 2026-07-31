import debug from "../debugLogger.mjs";

export const createAchillesSkills = async ({
    workspace,
    AgentClass,
    startDir,
    logger = debug
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

        logger.log("[AchillesSkills] Initializing MainAgent", {
            startDir,
            workspaceRoot: process.env.PLOINKY_WORKSPACE_ROOT || "(not set)"
        });

        agent = new AgentClass({
            startDir,
            logger,
        });

        return agent;
    };

    const registerSkills = async () => {
        await ensureAgent();
        const skills = agent.getSkills();

        for (const record of skills) {
            const skillName = typeof record.name === "string" ? record.name.trim() : "";
            const commandName = skillName;
            if (!commandName || registered.has(commandName)) {
                continue;
            }

            const executeSkill = async (inputValues) => {
                await ensureAgent();
                const promptText = Array.isArray(inputValues)
                    ? inputValues.join(" ")
                    : (typeof inputValues === "string" ? inputValues : "");
                const out = await agent.executeSkill(skillName, promptText);
                if (out && typeof out === "object" && Object.prototype.hasOwnProperty.call(out, "result")) {
                    return out.result;
                }
                return out;
            };

            workspace.registerCommand(commandName, async (inputValues) => {
                const out = await executeSkill(inputValues);
                logger.log(`[AchillesSkills] ${commandName} executed, result: ${out}`);
                return out;
            });

            registered.add(commandName);
        }

        logger.log("[AchillesSkills] Command registration complete", {
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
            const result = await agent.executeSkill(skillName, text);
            if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "result")) {
                return result.result;
            }
            return result;
        }
    };
};
