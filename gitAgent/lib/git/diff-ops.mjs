import { runGit } from './run-git.mjs';
import { isGitRepoRelativePath } from './validators.mjs';

export function createDiffOps(ctx) {
  const { resolveRepoWorkTreePath, getGitBinary } = ctx;

  async function gitDiff({ path: repoPathArg, file, cached = false, ref = null }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    if (!isGitRepoRelativePath(file)) {
      throw new Error(`Invalid file path for git_diff: ${file}`);
    }
    const gitBinary = await getGitBinary(repoPath);
    const baseRef = ref && typeof ref === 'string' && ref.trim() ? ref.trim() : null;
  
    const diffAsAddedFile = async () => {
      try {
        const { stdout: noIndex } = await runGit(
          repoPath,
          [gitBinary, 'diff', '--no-index', '--', '/dev/null', file],
          // `git diff --no-index` returns exit code 1 when differences are found (expected for new files).
          { timeoutMs: 25000, okCodes: [0, 1] }
        );
        return noIndex;
      } catch {
        return '';
      }
    };
  
    // Default behavior (backwards compatible).
    if (!baseRef) {
      const args = cached ? [gitBinary, 'diff', '--cached', '--', file] : [gitBinary, 'diff', '--', file];
      const { stdout } = await runGit(repoPath, args, { timeoutMs: 25000 });
      return stdout;
    }
  
    // WebStorm-like behavior: show a diff against baseRef (ex: HEAD) even if the change is staged-only.
    // 1) working tree vs baseRef
    // 2) index vs baseRef (staged-only)
    // 3) untracked fallback via `--no-index` ("added file" diff)
    let stdout = '';
    try {
      const result = await runGit(repoPath, [gitBinary, 'diff', baseRef, '--', file], { timeoutMs: 25000 });
      stdout = result.stdout;
    } catch (error) {
      if (String(error?.message || '').includes(`bad revision '${baseRef}'`)) {
        return diffAsAddedFile();
      }
      throw error;
    }
    if (stdout && stdout.trim()) return stdout;
    try {
      const { stdout: cachedStdout } = await runGit(
        repoPath,
        [gitBinary, 'diff', '--cached', baseRef, '--', file],
        { timeoutMs: 25000 }
      );
      if (cachedStdout && cachedStdout.trim()) return cachedStdout;
    } catch {
      // ignore
    }
    return diffAsAddedFile();
  }

  return { gitDiff };
}
