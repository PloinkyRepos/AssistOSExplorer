import { spawn } from 'node:child_process';

export function normalizeErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || 'Unknown error';
  return String(error);
}

export async function runGit(cwd, args, { timeoutMs = 20000, okCodes = [0], input = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: process.env.GIT_TERMINAL_PROMPT || '0',
        GIT_OPTIONAL_LOCKS: process.env.GIT_OPTIONAL_LOCKS || '0',
        GIT_DISCOVERY_ACROSS_FILESYSTEM: process.env.GIT_DISCOVERY_ACROSS_FILESYSTEM || '1'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const abortTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`git timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    if (input !== null && input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(abortTimer);
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        reject(new Error('Git executable not found (spawn ENOENT). Install git or set ASSISTOS_GIT_BINARY to the full path of the git binary.'));
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(abortTimer);
      if ((okCodes || [0]).includes(code)) {
        resolve({ stdout, stderr });
        return;
      }
      const msg = stderr.trim() || stdout.trim() || `git exited with code ${code}`;
      if (msg.includes('not a git repository')) {
        reject(new Error('Not a git repository. Set the repo path to a folder inside a git repo (or the repo root).'));
        return;
      }
      reject(new Error(msg));
    });
  });
}
