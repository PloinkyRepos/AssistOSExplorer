import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const persistoModule = require("../../../node_modules/soplang/Persisto/index.cjs");

const resolvePersistenceFolder = () => {
  const folder = process.env.PERSISTENCE_FOLDER || "./work_space_data/";
  return path.resolve(process.cwd(), folder);
};

export async function action() {
  const persistence = await persistoModule.initialisePersisto();
  const [variables, documents, graph] = await Promise.all([
    persistence.getEveryVariableObject?.() ?? [],
    persistence.getEveryDocumentObject?.() ?? [],
    persistence.getGraph?.("GRAPH").catch(() => null),
  ]);

  const graphState = graph?.state || {};
  const graphSize = typeof graphState === "object" && graphState
    ? Object.keys(graphState).length
    : 0;

  const summary = [
    "Persisto summary:",
    `- Persistence folder: ${resolvePersistenceFolder()}`,
    `- Variables: ${Array.isArray(variables) ? variables.length : 0}`,
    `- Documents: ${Array.isArray(documents) ? documents.length : 0}`,
    `- Graph nodes: ${graphSize}`,
  ];

  return summary.join("\n");
}
