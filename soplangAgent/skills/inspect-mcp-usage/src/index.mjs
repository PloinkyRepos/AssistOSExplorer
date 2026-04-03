import fs from "node:fs/promises";

const resolvePath = (input) => {
  if (!input) return "/last-tool.log";
  if (typeof input === "string" && input.trim()) return input.trim();
  return "/last-tool.log";
};

export async function action(args = {}) {
  const { input } = args || {};
  const filePath = resolvePath(input);
  const content = await fs.readFile(filePath, "utf8");
  return content;
}
