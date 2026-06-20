import pathModule from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathModule.dirname(__filename);

export const WORKSPACE_BASE = pathModule.join(__dirname, '..', 'workspaces');
if (!fs.existsSync(WORKSPACE_BASE)) {
  fs.mkdirSync(WORKSPACE_BASE, { recursive: true });
}

export function getRoomWorkspacePath(roomId) {
  let safeRoomId = (roomId || 'global').replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeRoomId) {
    safeRoomId = 'global';
  }
  return pathModule.join(WORKSPACE_BASE, safeRoomId);
}

/**
 * Execute git commands safely via child_process.spawn
 */
export function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`[Git Exec] git ${args.join(' ')} in ${cwd}`);
    try {
      const gitProcess = spawn('git', args, { cwd });
      let stdout = '';
      let stderr = '';

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('error', (err) => {
        console.error(`[Git Spawn Error]`, err);
        reject(new Error(`Git command failed to start: ${err.message}`));
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errMessage = stderr.trim() || `Git exited with code ${code}`;
          console.error(`[Git Error] ${errMessage}`);
          reject(new Error(errMessage));
        }
      });
    } catch (err) {
      console.error(`[Git Execution Threw]`, err);
      reject(err);
    }
  });
}

/**
 * Convert a GitHub URL to an authenticated HTTPS URL with token
 */
export function getAuthenticatedGitUrl(url, token) {
  let cleanUrl = url.trim();

  // Translate SSH format to HTTPS format
  if (cleanUrl.startsWith('git@github.com:')) {
    const path = cleanUrl.substring(15);
    cleanUrl = `https://github.com/${path}`;
  }

  if (cleanUrl.startsWith('https://')) {
    const rest = cleanUrl.substring(8);
    if (rest.includes('@')) {
      cleanUrl = 'https://' + rest.split('@')[1];
    }
  }

  if (cleanUrl.startsWith('https://github.com/')) {
    return cleanUrl.replace('https://github.com/', `https://${token}@github.com/`);
  }
  return cleanUrl;
}

/**
 * Retrieve and decrypt GitHub token from request header
 */
export async function getGithubToken(uid, req, decrypt) {
  if (req && req.headers && req.headers['x-github-token']) {
    return decrypt(req.headers['x-github-token']);
  }
  throw new Error("Missing x-github-token header or authentication failed");
}
