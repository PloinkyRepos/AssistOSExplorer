import fs from "node:fs/promises";
import path from "node:path";
import { parseDocsFromMarkdown } from "../../../plugins/lib/markdownMetadata.mjs";
import { parseCommandsForUI } from "../../../node_modules/soplang/src/util/soplangUtil.js";

const resolveRoot = (input) => {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }
  return (
    process.env.SOPLANG_WORKSPACE_ROOT ||
    process.env.PLOINKY_CWD ||
    process.cwd()
  );
};

const walkMarkdownFiles = async (root) => {
  const results = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }
  return results;
};

export async function action(args = {}) {
  const { input } = args || {};
  const root = resolveRoot(input || "");
  const markdownFiles = await walkMarkdownFiles(root);

  const docs = {};
  let commandCount = 0;

  for (const filePath of markdownFiles) {
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (_) {
      continue;
    }
    const parsedDocs = parseDocsFromMarkdown(content, filePath, { pathModule: path });
    Object.entries(parsedDocs).forEach(([docId, docData]) => {
      const id = docId || path.basename(filePath, ".md");
      docs[id] = docs[id] || docData;

      const collectCommands = (commands) => {
        if (!commands || !commands.trim()) return;
        const parsed = parseCommandsForUI(commands);
        commandCount += parsed.length;
      };

      collectCommands(docData.commands || "");
      const chapters = Array.isArray(docData.chapters) ? docData.chapters : [];
      chapters.forEach((chapter) => {
        collectCommands(chapter?.commands || "");
        const paragraphs = Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : [];
        paragraphs.forEach((paragraph) => {
          collectCommands(paragraph?.commands || "");
        });
      });
    });
  }

  const summary = [
    "Workspace scan summary:",
    `- Root: ${root}`,
    `- Markdown files: ${markdownFiles.length}`,
    `- Documents: ${Object.keys(docs).length}`,
    `- SOPLang commands: ${commandCount}`,
  ];

  return summary.join("\n");
}
