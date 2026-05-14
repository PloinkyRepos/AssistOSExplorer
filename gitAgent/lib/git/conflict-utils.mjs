import { runGit } from './run-git.mjs';

export function extractConflictPathsFromOutput(output) {
  const text = String(output || '');
  if (!text.trim()) return [];
  const matches = new Set();
  const patterns = [
    /CONFLICT \([^)]+\): .*? in (.+)$/gim,
    /^([^:\n]+): needs merge$/gim,
    /^UU\s+(.+)$/gim,
    /^AA\s+(.+)$/gim,
    /^DD\s+(.+)$/gim,
    /^DU\s+(.+)$/gim,
    /^UD\s+(.+)$/gim,
    /^AU\s+(.+)$/gim,
    /^UA\s+(.+)$/gim,
    /^both modified:\s+(.+)$/gim,
    /^both added:\s+(.+)$/gim,
    /^both deleted:\s+(.+)$/gim,
    /^deleted by us:\s+(.+)$/gim,
    /^deleted by them:\s+(.+)$/gim,
    /^added by us:\s+(.+)$/gim,
    /^added by them:\s+(.+)$/gim
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = String(match[1] || '').trim();
      if (!candidate) continue;
      matches.add(candidate.replace(/^["']|["']$/g, ''));
    }
  }
  return Array.from(matches).sort((a, b) => a.localeCompare(b));
}

export function hasGitConflictOutput(output) {
  const text = String(output || '');
  if (!text.trim()) return false;
  return /(^|\n)(CONFLICT \(|UU\s|AA\s|DD\s|DU\s|UD\s|AU\s|UA\s|both modified:|both added:|both deleted:|deleted by us:|deleted by them:|added by us:|added by them:|[^:\n]+: needs merge$)/im.test(text)
    || /\bunmerged\b/i.test(text);
}

export async function listUnmergedPaths(repoPath, gitBinary) {
  try {
    const { stdout } = await runGit(repoPath, [gitBinary, 'diff', '--name-only', '--diff-filter=U'], {
      timeoutMs: 10000
    });
    return stdout
      .split(/\r?\n/)
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
