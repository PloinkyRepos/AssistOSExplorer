export const deriveInvocation = (toolName, payload = {}) => {
    switch (toolName) {
        case "sync_markdown_documents":
            return {
                pluginName: "SoplangBuilder",
                methodName: "syncMarkdownDocuments",
                params: []
            };
        case "execute_workspace_build":
            return {
                pluginName: "SoplangBuilder",
                methodName: "executeWorkspaceBuild",
                params: []
            };
        case "get_variables_with_values":
            return {
                pluginName: "SoplangBuilder",
                methodName: "getVariablesWithValues",
                params: []
            };
        case "get_variable_with_value":
            return {
                pluginName: "SoplangBuilder",
                methodName: "getVariableWithValue",
                params: [payload.documentId, payload.varName]
            };
        case "get_commands":
            return {
                pluginName: "SoplangBuilder",
                methodName: "getCommands",
                params: []
            };
        case "get_types":
            return {
                pluginName: "SoplangBuilder",
                methodName: "getCustomTypes",
                params: []
            };
        case "execute_skill": {
            const params = [payload.skillName];
            if (payload.promptText !== undefined) {
                params.push(payload.promptText);
            }
            return {
                pluginName: "AchillesSkills",
                methodName: "executeSkill",
                params
            };
        }
        default:
            throw new Error(`Unsupported tool "${toolName}"`);
    }
};
