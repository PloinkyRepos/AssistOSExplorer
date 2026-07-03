import { extractConflictPathsFromOutput, hasGitConflictOutput, listUnmergedPaths } from './conflict-utils.mjs';
import { normalizeErrorMessage, runGit } from './run-git.mjs';

function cleanBranchName(value) {
  const branch = String(value || '').trim();
  if (!branch || branch === 'HEAD') {
    throw new Error('Branch name is required.');
  }
  if (branch.includes('\0') || branch.startsWith('-')) {
    throw new Error('Invalid branch name.');
  }
  return branch;
}

function cleanStartPoint(value) {
  const startPoint = String(value || '').trim();
  if (!startPoint) return '';
  if (startPoint.includes('\0') || startPoint.startsWith('-')) {
    throw new Error('Invalid branch start point.');
  }
  return startPoint;
}

function parseBranchRows(output, { currentBranch = '' } = {}) {
  const rows = String(output || '').split(/\r?\n/).filter(Boolean);
  return rows.map((line) => {
    const [refname, shortName, upstream, objectName, subject] = line.split('\t');
    const fullName = String(refname || '').trim();
    const name = String(shortName || '').trim();
    const isRemote = fullName.startsWith('refs/remotes/');
    return {
      name,
      fullName,
      type: isRemote ? 'remote' : 'local',
      upstream: String(upstream || '').trim() || null,
      objectName: String(objectName || '').trim() || null,
      subject: String(subject || '').trim() || null,
      current: Boolean(currentBranch && !isRemote && name === currentBranch)
    };
  }).filter((entry) => {
    if (!entry.name) return false;
    if (entry.type === 'remote' && /\/HEAD$/.test(entry.name)) return false;
    return true;
  });
}

export function createBranchOps(ctx) {
  const { resolveRepoWorkTreePath, getGitBinary } = ctx;

  async function validateNewBranchName(repoPath, gitBinary, branch) {
    await runGit(repoPath, [gitBinary, 'check-ref-format', '--branch', branch], { timeoutMs: 5000 });
  }

  async function getCurrentBranch(repoPath, gitBinary) {
    try {
      const { stdout } = await runGit(repoPath, [gitBinary, 'branch', '--show-current'], { timeoutMs: 5000 });
      return String(stdout || '').trim();
    } catch {
      return '';
    }
  }

  async function getBranchNames(repoPath, gitBinary) {
    const { stdout } = await runGit(repoPath, [
      gitBinary,
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
      'refs/remotes'
    ], { timeoutMs: 10000 });
    return String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async function getLocalBranchNames(repoPath, gitBinary) {
    const { stdout } = await runGit(repoPath, [
      gitBinary,
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads'
    ], { timeoutMs: 10000 });
    return String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async function assertExistingBranch(repoPath, gitBinary, branch) {
    const names = await getBranchNames(repoPath, gitBinary);
    if (!names.includes(branch)) {
      throw new Error(`Branch not found: ${branch}`);
    }
  }

  async function gitBranchList({ path: repoPathArg }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const currentBranch = await getCurrentBranch(repoPath, gitBinary);
    const { stdout } = await runGit(repoPath, [
      gitBinary,
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)\t%(refname:short)\t%(upstream:short)\t%(objectname)\t%(subject)',
      'refs/heads',
      'refs/remotes'
    ], { timeoutMs: 10000 });
    const branches = parseBranchRows(stdout, { currentBranch });
    const locals = branches.filter((entry) => entry.type === 'local').sort((a, b) => a.name.localeCompare(b.name));
    const remotes = branches.filter((entry) => entry.type === 'remote').sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      repoPath,
      currentBranch: currentBranch || null,
      branches: [...locals, ...remotes]
    };
  }

  async function gitBranchCheckout({ path: repoPathArg, branch }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const target = cleanBranchName(branch);
    await assertExistingBranch(repoPath, gitBinary, target);
    const before = await getCurrentBranch(repoPath, gitBinary);
    const locals = await getLocalBranchNames(repoPath, gitBinary);
    const isLocal = locals.includes(target);
    const remoteLocalName = target.includes('/') ? target.split('/').slice(1).join('/') : '';
    const shouldTrackRemote = !isLocal && remoteLocalName && !locals.includes(remoteLocalName);
    const args = shouldTrackRemote
      ? [gitBinary, 'checkout', '--track', target]
      : [gitBinary, 'checkout', target];
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 60000 });
    const currentBranch = await getCurrentBranch(repoPath, gitBinary);
    return { ok: true, repoPath, branch: currentBranch || target, previousBranch: before || null, stdout, stderr };
  }

  async function gitBranchCreate({ path: repoPathArg, name, startPoint = '', checkout = true }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const branch = cleanBranchName(name);
    const base = cleanStartPoint(startPoint);
    await validateNewBranchName(repoPath, gitBinary, branch);
    const args = [gitBinary, checkout === false ? 'branch' : 'checkout'];
    if (checkout !== false) args.push('-b');
    args.push(branch);
    if (base) args.push(base);
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 60000 });
    const currentBranch = await getCurrentBranch(repoPath, gitBinary);
    return { ok: true, repoPath, branch, currentBranch: currentBranch || null, checkedOut: checkout !== false, stdout, stderr };
  }

  async function gitBranchMerge({ path: repoPathArg, sourceBranch, noFf = false }) {
    const repoPath = await resolveRepoWorkTreePath(repoPathArg);
    const gitBinary = await getGitBinary(repoPath);
    const source = cleanBranchName(sourceBranch);
    await assertExistingBranch(repoPath, gitBinary, source);
    const currentBranch = await getCurrentBranch(repoPath, gitBinary);
    if (currentBranch && currentBranch === source) {
      throw new Error('Cannot merge a branch into itself.');
    }
    const args = [gitBinary, 'merge'];
    if (noFf) args.push('--no-ff');
    args.push(source);
    const { stdout, stderr } = await runGit(repoPath, args, { timeoutMs: 120000, okCodes: [0, 1] });
    const output = `${stdout}\n${stderr}`.trim();
    const conflicts = hasGitConflictOutput(output);
    let conflictPaths = conflicts ? extractConflictPathsFromOutput(output) : [];
    if (conflicts) {
      const unmergedPaths = await listUnmergedPaths(repoPath, gitBinary);
      if (unmergedPaths.length) {
        conflictPaths = unmergedPaths;
      }
    }
    const lower = output.toLowerCase();
    const error = !conflicts && (lower.includes('fatal:') || lower.includes('error:'));
    if (error) {
      throw new Error(normalizeErrorMessage(output));
    }
    return {
      ok: !conflicts,
      repoPath,
      sourceBranch: source,
      targetBranch: currentBranch || null,
      conflicts,
      conflictPaths,
      stdout,
      stderr,
      output
    };
  }

  return {
    gitBranchList,
    gitBranchCheckout,
    gitBranchCreate,
    gitBranchMerge
  };
}
