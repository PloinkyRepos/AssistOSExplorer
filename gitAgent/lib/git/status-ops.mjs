import { runGit } from './run-git.mjs';
import { categorizeStatusEntries, parseStatusPorcelainV1Z } from './status-parser.mjs';

export function createStatusOps(ctx) {
  const { resolveRepoWorkTreePath, getGitBinary } = ctx;

  async function gitStatus({ path: repoPathArg, includeAhead = false }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const { stdout } = await runGit(repoPath, [gitBinary, 'status', '--porcelain=v1', '-z', '-uall', '--ignored=matching']);
    const entries = parseStatusPorcelainV1Z(stdout);
    const status = categorizeStatusEntries(entries);
    if (!includeAhead) {
      return { ok: true, status };
    }
    let branch = null;
    let upstream = null;
    let ahead = null;
    let behind = null;
    try {
      const { stdout: branchOut } = await runGit(repoPath, [gitBinary, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 });
      branch = String(branchOut || '').trim() || null;
    } catch {
      branch = null;
    }
    try {
      const { stdout: upstreamOut } = await runGit(repoPath, [gitBinary, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 5000 });
      upstream = String(upstreamOut || '').trim() || null;
    } catch {
      upstream = null;
    }
    if (upstream) {
      try {
        const { stdout: countsOut } = await runGit(repoPath, [gitBinary, 'rev-list', '--left-right', '--count', `${upstream}...HEAD`], { timeoutMs: 5000 });
        const [behindRaw, aheadRaw] = String(countsOut || '').trim().split(/\s+/);
        const behindNum = Number(behindRaw);
        const aheadNum = Number(aheadRaw);
        if (Number.isFinite(aheadNum)) ahead = aheadNum;
        if (Number.isFinite(behindNum)) behind = behindNum;
      } catch {
        ahead = null;
        behind = null;
      }
    }
    return { ok: true, status, branch, upstream, ahead, behind };
  }
  
  async function gitStatusOverview({ path: repoPathArg, includeUntracked = false }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const untrackedFlag = includeUntracked ? '-uall' : '-uno';
    const { stdout } = await runGit(
      repoPath,
      // `--no-optional-locks` is a global git option (must be before the subcommand).
      [
        gitBinary,
        '--no-optional-locks',
        'status',
        '--porcelain=v1',
        '-z',
        untrackedFlag,
        ...(includeUntracked ? ['--ignored=matching'] : [])
      ],
      { timeoutMs: 5000 }
    );
    const entries = parseStatusPorcelainV1Z(stdout);
    const status = categorizeStatusEntries(entries);
    if (!includeUntracked) {
      status.untracked = [];
      status.ignored = [];
    }
    return { ok: true, status };
  }

  return {
    gitStatus,
    gitStatusOverview,
  };
}
