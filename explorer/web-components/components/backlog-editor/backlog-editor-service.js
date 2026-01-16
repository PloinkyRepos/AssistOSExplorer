export function createBacklogEditorService({ callTool, callAgentTool }) {
    return {
        analyze: (content, context, modelName) => callAgentTool('explorerSkillsAgent', 'skills_execute', {
            skillName: 'backlog-skill',
            input: {
                action: 'analyze',
                backlogContent: content,
                context,
                modelName
            }
        }),
        regenerateItem: (planItem, feedback, modelName) => callAgentTool('explorerSkillsAgent', 'skills_execute', {
            skillName: 'backlog-skill',
            input: {
                action: 'regenerate_item',
                planItem,
                userFeedback: feedback,
                modelName
            }
        }),
        reviewPlan: (plan, modelName) => callAgentTool('explorerSkillsAgent', 'skills_execute', {
            skillName: 'backlog-skill',
            input: {
                action: 'review_plan',
                plan,
                modelName
            }
        }),
        executePlan: (plan, modelName) => callAgentTool('explorerSkillsAgent', 'skills_execute', {
            skillName: 'backlog-skill',
            input: {
                action: 'execute_plan',
                plan,
                modelName
            }
        }),
        getAvailableModels: () => callAgentTool('explorerSkillsAgent', 'skills_execute', {
            skillName: 'llm-models',
            input: {}
        }),
        readTextFile: (path) => callTool('read_text_file', { path }),
        writeFile: (path, content) => callTool('write_file', { path, content })
    };
}
