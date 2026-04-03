import { createSoplangBuilder } from "./lib/soplangBuilderCore.mjs";

async function SoplangBuilder() {
    const self = {};
    const workspace = $$.loadPlugin("Workspace");
    const documents = $$.loadPlugin("Documents");
    return Object.assign(self, createSoplangBuilder({ workspace, documents }));
}

let singletonInstance;

export async function getInstance() {
    if (!singletonInstance) {
        singletonInstance = await SoplangBuilder();
    }
    return singletonInstance;
}

export function getAllow() {
    return async () => true;
}

export function getDependencies() {
    return ["Workspace", "Documents"];
}
