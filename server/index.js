/**
 * Technify Collab Server — Main Entry Point
 * 
 * Modular Express + WebSocket server for real-time collaborative coding.
 * 
 * Architecture:
 *   - Express REST API for GitHub, Git, Workspace, and AI endpoints
 *   - y-websocket for real-time collaborative editing (CRDT via Yjs)
 *   - LevelDB persistence for document state survival across restarts
 *   - WebSocket authentication via Firebase ID tokens
 *   - Socket.IO for room events and presence signaling
 */

import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import pathModule from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathModule.dirname(__filename);

// Load .env from parent workspace root directory
dotenv.config({ path: pathModule.join(__dirname, '../.env') });

const PORT = process.env.PORT || 4000;

// ========================================
// Express App Setup
// ========================================

const app = express();
app.use(cors());
app.use(express.json());

// ========================================
// Utility Imports
// ========================================

import { encrypt, decrypt } from './utils/crypto.js';
import { getRoomWorkspacePath, runGit, getAuthenticatedGitUrl } from './utils/git.js';
import { initFirebaseAdmin, authenticateWsConnection } from './middleware/wsAuth.js';
import workspaceRoutes from './routes/workspace.js';

// Initialize Firebase Admin for WS auth
initFirebaseAdmin();

// ========================================
// Workspace File System API
// ========================================

app.use('/api/workspace', workspaceRoutes);

// ========================================
// Encryption & Token Helpers (used by routes below)
// ========================================

// In-Memory Repository Cache (TTL: 2 minutes)
const reposCache = new Map();
const CACHE_TTL = 2 * 60 * 1000;

// Retrieve and decrypt GitHub token for a user
async function getGithubToken(uid, req) {
  if (req && req.headers && req.headers['x-github-token']) {
    return decrypt(req.headers['x-github-token']);
  }
  throw new Error("Missing x-github-token header or authentication failed");
}

// ========================================
// OpenAI / OpenRouter Setup
// ========================================

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || 'dummy-key',
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:5173',
    'X-Title': 'Technify Workspace',
  }
});

// ========================================
// Health Check
// ========================================

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Technify Collab Server', version: '2.0.0' });
});

// ========================================
// GitHub OAuth Endpoints
// ========================================

// 1. Authorize Redirect
app.get('/api/github/login', (req, res) => {
  const { uid, redirect_origin } = req.query;
  if (!uid) {
    return res.status(400).send('Missing uid query parameter');
  }

  const origin = redirect_origin || 'http://localhost:5173';
  const state = `${uid}__${origin}`;
  const clientId = process.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    console.log("[GitHub] Missing GITHUB_CLIENT_ID. Redirecting to mock callback flow.");
    return res.redirect(`/api/github/callback?code=mock_code&state=${encodeURIComponent(state)}`);
  }

  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo,read:user,user:email,workflow&state=${encodeURIComponent(state)}`;
  res.redirect(githubAuthUrl);
});

// 2. OAuth Callback
app.get('/api/github/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!state) {
    return res.status(400).send('Missing state parameter');
  }

  const [uid, redirectOrigin] = state.split('__');
  const targetOrigin = redirectOrigin || 'http://localhost:5173';

  try {
    let accessToken, githubUser;

    if (process.env.GITHUB_CLIENT_ID && code !== 'mock_code') {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: process.env.GITHUB_REDIRECT_URI
        })
      });

      const tokenData = await tokenResponse.json();
      if (tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error);
      }

      accessToken = tokenData.access_token;

      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'User-Agent': 'Technify-Cloud-IDE'
        }
      });

      if (!userResponse.ok) {
        throw new Error("Failed to fetch user profile from GitHub");
      }

      githubUser = await userResponse.json();
      console.log(`[GitHub] Real OAuth success for @${githubUser.login}`);
    } else {
      accessToken = 'mock_access_token';
      githubUser = {
        id: 991901,
        login: 'mock-developer',
        avatar_url: 'https://avatars.githubusercontent.com/u/9919?v=4',
        public_repos: 42
      };
      console.log("[GitHub] Mock authentication callback success");
    }

    const encryptedToken = encrypt(accessToken);
    console.log(`[GitHub] OAuth callback success for @${githubUser.login}. Redirecting to client.`);

    res.redirect(`${targetOrigin}/profile?connected=github&github_username=${encodeURIComponent(githubUser.login)}&github_avatar=${encodeURIComponent(githubUser.avatar_url)}&github_id=${githubUser.id}&github_repos=${githubUser.public_repos || 0}&encrypted_token=${encodeURIComponent(encryptedToken)}`);
  } catch (err) {
    console.error("GitHub callback exchange error:", err);
    res.redirect(`${targetOrigin}/profile?error=${encodeURIComponent(err.message)}`);
  }
});

app.post('/api/github/disconnect', async (req, res) => {
  const { uid } = req.body;
  if (!uid) {
    return res.status(400).json({ error: 'Missing uid' });
  }
  console.log(`[GitHub] Disconnected invoked for user ${uid}.`);
  res.json({ success: true, message: 'Disconnected successfully' });
});

// 4. Connect via Personal Access Token (PAT)
app.post('/api/github/connect-pat', async (req, res) => {
  const { uid, token } = req.body;
  if (!uid || !token) {
    return res.status(400).json({ error: 'Missing uid or token' });
  }

  try {
    let githubUser;
    let encryptedToken;

    if (token === 'ghp_mock_token' || token === 'mock_access_token') {
      githubUser = {
        id: 991901,
        login: 'mock-developer',
        avatar_url: 'https://avatars.githubusercontent.com/u/9919?v=4',
        public_repos: 42
      };
      encryptedToken = encrypt(token);
    } else {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'User-Agent': 'Technify-Cloud-IDE'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub token validation failed with status: ${response.status}`);
      }

      githubUser = await response.json();
      encryptedToken = encrypt(token);
    }

    const now = new Date().toISOString();
    console.log(`[GitHub] PAT validation successful for @${githubUser.login}.`);

    res.json({
      success: true,
      githubUsername: githubUser.login,
      githubAvatar: githubUser.avatar_url,
      githubId: githubUser.id,
      githubConnectedAt: now,
      githubPublicRepos: githubUser.public_repos || 0,
      encryptedToken: encryptedToken,
      connectionType: 'pat'
    });
  } catch (err) {
    console.error("Error connecting via PAT:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// GitHub REST API Proxy Endpoints
// ========================================

// Mock data storage for local simulation
const mockUserRepositories = [
  { id: 101, name: 'todo-list-app', description: 'A simple HTML/CSS/JS Todo list application', private: false, html_url: 'https://github.com/mock-developer/todo-list-app', default_branch: 'main', updated_at: new Date().toISOString() },
  { id: 102, name: 'react-dashboard', description: 'Interactive metrics dashboard with ChartJS', private: true, html_url: 'https://github.com/mock-developer/react-dashboard', default_branch: 'master', updated_at: new Date().toISOString() },
  { id: 103, name: 'python-algorithms', description: 'Common sorting and search algorithms in Python', private: false, html_url: 'https://github.com/mock-developer/python-algorithms', default_branch: 'main', updated_at: new Date().toISOString() }
];

const mockRepoFiles = {
  'todo-list-app': {
    'index.html': `<!DOCTYPE html>\n<html>\n<head>\n  <title>Todo List</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <h1>Todo List</h1>\n  <input id="new-todo" placeholder="Add task...">\n  <button onclick="add()">Add</button>\n  <ul id="list"></ul>\n  <script src="script.js"></script>\n</body>\n</html>`,
    'styles.css': `body { font-family: sans-serif; background: #fafafa; padding: 20px; }\nh1 { color: #333; }`,
    'script.js': `function add() {\n  const val = document.getElementById("new-todo").value;\n  if(!val) return;\n  const li = document.createElement("li");\n  li.textContent = val;\n  document.getElementById("list").appendChild(li);\n  document.getElementById("new-todo").value = "";\n}`
  },
  'react-dashboard': {
    'src/App.jsx': `import React from 'react';\nexport default function App() {\n  return <div>Welcome to Dashboard!</div>;\n}`
  },
  'python-algorithms': {
    'main.py': `def bubble_sort(arr):\n    n = len(arr)\n    for i in range(n):\n        for j in range(0, n-i-1):\n            if arr[j] > arr[j+1]:\n                arr[j], arr[j+1] = arr[j+1], arr[j]\n    return arr\n\nprint(bubble_sort([64, 34, 25, 12, 22, 11, 90]))`,
    'utils.py': `# Helper utilities for sorting algorithms\ndef swap(arr, i, j):\n    arr[i], arr[j] = arr[j], arr[i]`
  }
};

const mockRepoBranches = {
  'todo-list-app': ['main', 'dev'],
  'react-dashboard': ['master', 'feature-auth'],
  'python-algorithms': ['main']
};

// 1. List User Repositories
app.get('/api/github/repos', async (req, res) => {
  const { uid } = req.query;
  if (!uid) {
    return res.status(400).json({ error: 'Missing uid parameter' });
  }

  const cached = reposCache.get(uid);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return res.json(cached.data);
  }

  try {
    const token = await getGithubToken(uid, req);
    if (token === 'mock_access_token') {
      return res.json(mockUserRepositories);
    }

    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API list repos returned status: ${response.status}`);
    }

    const data = await response.json();
    const filtered = data.map(repo => ({
      id: repo.id,
      name: repo.name,
      description: repo.description,
      private: repo.private,
      html_url: repo.html_url,
      default_branch: repo.default_branch,
      updated_at: repo.updated_at,
      owner: repo.owner?.login
    }));

    reposCache.set(uid, { data: filtered, timestamp: Date.now() });
    res.json(filtered);
  } catch (err) {
    console.error("Error fetching GitHub repos:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Create Repository
async function createRepoHandler(req, res) {
  const { uid, name, description, isPrivate, private: reqPrivate, initReadme } = req.body;
  const actualPrivate = reqPrivate !== undefined ? reqPrivate : (isPrivate || false);
  try {
    const token = await getGithubToken(uid, req);

    if (token === 'mock_access_token') {
      const newRepo = {
        id: Math.floor(Math.random() * 100000),
        name,
        description,
        private: actualPrivate,
        html_url: `https://github.com/mock-developer/${name}`,
        default_branch: 'main',
        updated_at: new Date().toISOString()
      };
      mockUserRepositories.unshift(newRepo);
      mockRepoFiles[name] = { 'README.md': `# ${name}\n\n${description || ''}` };
      mockRepoBranches[name] = ['main'];
      reposCache.delete(uid);
      return res.json(newRepo);
    }

    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      },
      body: JSON.stringify({
        name,
        description,
        private: actualPrivate,
        auto_init: initReadme !== undefined ? initReadme : true
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || `GitHub repo creation failed with status: ${response.status}`);
    }

    const data = await response.json();
    reposCache.delete(uid);

    res.json({
      id: data.id,
      name: data.name,
      description: data.description,
      private: data.private,
      html_url: data.html_url,
      default_branch: data.default_branch,
      updated_at: data.updated_at,
      owner: data.owner?.login
    });
  } catch (err) {
    console.error("Error creating repo:", err);
    res.status(500).json({ error: err.message });
  }
}

app.post('/api/github/repos/create', createRepoHandler);
app.post('/api/github/create-repo', createRepoHandler);

// 3. List Branches
const branchesHandler = async (req, res) => {
  const { uid, roomId, owner, repo } = req.query;
  try {
    const roomPath = getRoomWorkspacePath(roomId);

    if (roomId && fs.existsSync(pathModule.join(roomPath, '.git'))) {
      const stdout = await runGit(['branch', '-a'], roomPath);
      const branches = stdout.split('\n').map(line => {
        const isCurrent = line.startsWith('*');
        let name = line.replace(/^\*?\s+/, '').trim();
        if (name.startsWith('remotes/origin/')) {
          name = name.replace('remotes/origin/', '');
        }
        if (name.includes('->')) return null;
        return { name, isCurrent };
      }).filter(Boolean);

      const uniqueNames = new Set();
      const uniqueBranches = [];
      branches.forEach(b => {
        if (!uniqueNames.has(b.name)) {
          uniqueNames.add(b.name);
          uniqueBranches.push(b);
        }
      });
      return res.json(uniqueBranches);
    }

    const token = await getGithubToken(uid, req);
    if (token === 'mock_access_token') {
      const branches = mockRepoBranches[repo] || ['main'];
      return res.json(branches.map(b => ({ name: b, isCurrent: b === 'main' })));
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch branches from GitHub API");
    }
    const data = await response.json();
    res.json(data.map((b, index) => ({ name: b.name, isCurrent: index === 0 })));
  } catch (err) {
    console.error("Error listing branches:", err);
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/github/repos/branches', branchesHandler);
app.get('/api/github/branches', branchesHandler);

// 4. Create Branch
const createBranchHandler = async (req, res) => {
  const { uid, roomId, branchName, fromBranch, owner, repo } = req.body;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    if (roomId && fs.existsSync(pathModule.join(roomPath, '.git'))) {
      const token = await getGithubToken(uid, req);

      await runGit(['checkout', '-b', branchName, fromBranch ? `origin/${fromBranch}` : undefined].filter(Boolean), roomPath);

      try {
        let remoteUrl = await runGit(['remote', 'get-url', 'origin'], roomPath);
        if (remoteUrl) {
          const authenticatedUrl = getAuthenticatedGitUrl(remoteUrl, token);
          await runGit(['remote', 'set-url', 'origin', authenticatedUrl], roomPath);
          await runGit(['push', '-u', 'origin', branchName], roomPath);
        }
      } catch (e) {
        console.log("Failed to push newly created branch to remote origin:", e.message);
      }
      return res.json({ success: true, name: branchName });
    }

    const token = await getGithubToken(uid, req);
    if (token === 'mock_access_token') {
      if (!mockRepoBranches[repo]) {
        mockRepoBranches[repo] = ['main'];
      }
      if (!mockRepoBranches[repo].includes(branchName)) {
        mockRepoBranches[repo].push(branchName);
      }
      return res.json({ success: true, name: branchName });
    }

    const refResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      }
    });

    if (!refResponse.ok) {
      throw new Error(`Failed to locate source branch ${fromBranch}`);
    }

    const refData = await refResponse.json();
    const sourceSha = refData.object.sha;

    const createResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: sourceSha
      })
    });

    if (!createResponse.ok) {
      const errData = await createResponse.json();
      throw new Error(errData.message || "Failed to create new branch ref");
    }

    res.json({ success: true, name: branchName });
  } catch (err) {
    console.error("Error creating branch:", err);
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/github/repos/branches/create', createBranchHandler);
app.post('/api/github/branches/create', createBranchHandler);

// 4.5 Switch Branch Locally
app.post('/api/github/branches/switch', async (req, res) => {
  const { uid, roomId, branchName, activeFilePath } = req.body;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    if (!fs.existsSync(pathModule.join(roomPath, '.git'))) {
      return res.status(400).json({ error: 'Workspace local Git is not initialized' });
    }

    try { await runGit(['stash'], roomPath); } catch(e) {}

    await runGit(['checkout', branchName], roomPath);

    try {
      const token = await getGithubToken(uid, req);
      let remoteUrl = await runGit(['remote', 'get-url', 'origin'], roomPath);
      if (remoteUrl) {
        const authenticatedUrl = getAuthenticatedGitUrl(remoteUrl, token);
        await runGit(['remote', 'set-url', 'origin', authenticatedUrl], roomPath);
        await runGit(['pull', 'origin', branchName], roomPath);
      }
    } catch (e) {
      console.log("Pulling switched branch failed or skipped:", e.message);
    }

    try { await runGit(['stash', 'pop'], roomPath); } catch(e) {}

    let content = '';
    if (activeFilePath) {
      const fullPath = pathModule.join(roomPath, activeFilePath);
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, 'utf8');
      }
    }

    res.json({ success: true, message: `Successfully switched to branch ${branchName}`, content });
  } catch (err) {
    console.error("Error switching branch locally:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Git tree
app.get('/api/github/repos/tree', async (req, res) => {
  const { uid, owner, repo, branch, roomId } = req.query;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    if (roomId && fs.existsSync(pathModule.join(roomPath, '.git'))) {
      const stdout = await runGit(['ls-files'], roomPath);
      const tree = stdout.split('\n').filter(Boolean).map(filePath => {
        const fullPath = pathModule.join(roomPath, filePath);
        let size = 0;
        try { size = fs.statSync(fullPath).size; } catch (e) {}
        return { path: filePath, type: 'blob', size };
      });
      return res.json({ tree });
    }

    const token = await getGithubToken(uid, req);
    if (token === 'mock_access_token') {
      const files = mockRepoFiles[repo] || {};
      const tree = Object.keys(files).map(filePath => ({
        path: filePath, type: 'blob', size: files[filePath].length
      }));
      return res.json({ tree });
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch repository file tree");
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error listing tree:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Get File Content
app.get('/api/github/repos/contents', async (req, res) => {
  const { uid, owner, repo, branch, path: filePath, roomId } = req.query;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    if (roomId && fs.existsSync(pathModule.join(roomPath, '.git'))) {
      const fullPath = pathModule.join(roomPath, filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        return res.json({
          content: Buffer.from(content).toString('base64'),
          sha: 'local_sha_' + filePath.replace(/\//g, '_')
        });
      }
    }

    const token = await getGithubToken(uid, req);
    if (token === 'mock_access_token') {
      const files = mockRepoFiles[repo] || {};
      const fileText = files[filePath];
      if (fileText === undefined) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.json({
        content: Buffer.from(fileText).toString('base64'),
        sha: 'mock_sha_' + filePath.replace(/\//g, '_')
      });
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      }
    });

    if (!response.ok) {
      throw new Error("Failed to load file contents from GitHub");
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error loading file content:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Commit changes locally
const commitHandler = async (req, res) => {
  const { uid, roomId, path: filePath, content, commitMessage } = req.body;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    if (!fs.existsSync(pathModule.join(roomPath, '.git'))) {
      return res.status(400).json({ error: 'Local Git repository is not initialized' });
    }

    const fullPath = pathModule.join(roomPath, filePath);
    const fileDir = pathModule.dirname(fullPath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');

    await runGit(['add', '.'], roomPath);
    const output = await runGit(['commit', '-m', commitMessage || 'Updates from Workspace'], roomPath);

    res.json({ success: true, message: 'Changes committed locally successfully', output });
  } catch (err) {
    console.error("Local Git commit failed:", err);
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/github/repos/commit', commitHandler);
app.post('/api/github/commit', commitHandler);

// 7.1 Push to Remote
app.post('/api/github/push', async (req, res) => {
  const { uid, roomId, branch } = req.body;
  try {
    const token = await getGithubToken(uid, req);
    const roomPath = getRoomWorkspacePath(roomId);

    let remoteUrl = await runGit(['remote', 'get-url', 'origin'], roomPath);
    if (!remoteUrl) {
      return res.status(400).json({ error: 'No remote origin connected to local repository' });
    }

    const authenticatedUrl = getAuthenticatedGitUrl(remoteUrl, token);
    await runGit(['remote', 'set-url', 'origin', authenticatedUrl], roomPath);

    const output = await runGit(['push', 'origin', branch || 'main'], roomPath);
    res.json({ success: true, message: 'Pushed to GitHub successfully', output });
  } catch (err) {
    console.error("Local Git push failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7.2 Pull from Remote
app.post('/api/github/pull', async (req, res) => {
  const { uid, roomId, branch, activeFilePath } = req.body;
  try {
    const token = await getGithubToken(uid, req);
    const roomPath = getRoomWorkspacePath(roomId);

    let remoteUrl = await runGit(['remote', 'get-url', 'origin'], roomPath);
    if (remoteUrl) {
      const authenticatedUrl = getAuthenticatedGitUrl(remoteUrl, token);
      await runGit(['remote', 'set-url', 'origin', authenticatedUrl], roomPath);
    }

    const output = await runGit(['pull', 'origin', branch || 'main'], roomPath);

    let content = '';
    if (activeFilePath) {
      const fullPath = pathModule.join(roomPath, activeFilePath);
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, 'utf8');
      }
    }

    res.json({ success: true, message: 'Pulled from GitHub successfully', content, output });
  } catch (err) {
    console.error("Local Git pull failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7.2.5 Get Git Status Locally
app.get('/api/github/status', async (req, res) => {
  const { roomId } = req.query;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    const gitDirExists = fs.existsSync(pathModule.join(roomPath, '.git'));

    if (!gitDirExists) {
      return res.json({
        initialized: false,
        remoteUrl: null,
        currentBranch: null,
        hasRemote: false,
        repoOwner: null,
        repoName: null
      });
    }

    let remoteUrl = null;
    try { remoteUrl = await runGit(['remote', 'get-url', 'origin'], roomPath); } catch (e) {}

    let currentBranch = null;
    try {
      currentBranch = await runGit(['branch', '--show-current'], roomPath);
      if (!currentBranch) {
        currentBranch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], roomPath);
      }
    } catch (e) {
      currentBranch = 'main';
    }

    let repoOwner = null;
    let repoName = null;
    if (remoteUrl) {
      const cleanUrl = remoteUrl.trim();
      const match = cleanUrl.match(/(?:github\.com[:\\/])([^\\/]+)\/([^\\/\\.]+)(?:\.git)?$/);
      if (match) {
        repoOwner = match[1];
        repoName = match[2];
      }
    }

    res.json({
      initialized: true,
      remoteUrl,
      currentBranch,
      hasRemote: !!remoteUrl,
      repoOwner,
      repoName
    });
  } catch (err) {
    console.error("Git status check failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7.3 Git Init Locally
app.post('/api/github/init', async (req, res) => {
  const { uid, roomId } = req.body;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    if (!fs.existsSync(roomPath)) {
      fs.mkdirSync(roomPath, { recursive: true });
    }
    if (!fs.existsSync(pathModule.join(roomPath, '.git'))) {
      await runGit(['init'], roomPath);
    }
    res.json({ success: true, message: 'Git repository initialized locally' });
  } catch (err) {
    console.error("Git init failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7.4 Git Remote Add Locally
app.post('/api/github/remote-add', async (req, res) => {
  const { uid, roomId, remoteUrl } = req.body;
  try {
    const token = await getGithubToken(uid, req);
    const roomPath = getRoomWorkspacePath(roomId);

    if (!fs.existsSync(pathModule.join(roomPath, '.git'))) {
      await runGit(['init'], roomPath);
    }

    let remoteExists = false;
    try { await runGit(['remote', 'get-url', 'origin'], roomPath); remoteExists = true; } catch(e) {}

    const authenticatedUrl = getAuthenticatedGitUrl(remoteUrl, token);
    if (remoteExists) {
      await runGit(['remote', 'set-url', 'origin', authenticatedUrl], roomPath);
    } else {
      await runGit(['remote', 'add', 'origin', authenticatedUrl], roomPath);
    }

    res.json({ success: true, message: 'Remote origin added successfully' });
  } catch (err) {
    console.error("Git remote add failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7.5 Git Clone Locally
app.post('/api/github/clone', async (req, res) => {
  const { uid, roomId, owner, repo, branch } = req.body;
  try {
    const token = await getGithubToken(uid, req);
    const roomPath = getRoomWorkspacePath(roomId);

    if (fs.existsSync(roomPath)) {
      fs.rmSync(roomPath, { recursive: true, force: true });
    }
    fs.mkdirSync(roomPath, { recursive: true });

    const cloneUrl = `https://${token}@github.com/${owner}/${repo}.git`;
    await runGit(['clone', '-b', branch || 'main', cloneUrl, '.'], roomPath);

    const files = fs.readdirSync(roomPath);
    const defaultFile = files.find(f => f.toLowerCase() === 'readme.md') || files.find(f => f.endsWith('.js') || f.endsWith('.py')) || files[0] || 'README.md';

    let fileContent = '';
    const defaultFilePath = pathModule.join(roomPath, defaultFile);
    if (fs.existsSync(defaultFilePath) && fs.statSync(defaultFilePath).isFile()) {
      fileContent = fs.readFileSync(defaultFilePath, 'utf8');
    }

    res.json({
      success: true,
      message: 'Workspace cloned successfully from remote',
      defaultFile,
      content: fileContent
    });
  } catch (err) {
    console.error("Git clone failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Delete local branch
app.post('/api/github/repos/branches/delete', async (req, res) => {
  const { uid, owner, repo, branchName, roomId } = req.body;
  try {
    const roomPath = getRoomWorkspacePath(roomId);
    if (roomId && fs.existsSync(pathModule.join(roomPath, '.git'))) {
      await runGit(['branch', '-D', branchName], roomPath);

      try {
        const token = await getGithubToken(uid, req);
        let remoteUrl = await runGit(['remote', 'get-url', 'origin'], roomPath);
        if (remoteUrl) {
          const authenticatedUrl = getAuthenticatedGitUrl(remoteUrl, token);
          await runGit(['remote', 'set-url', 'origin', authenticatedUrl], roomPath);
          await runGit(['push', 'origin', '--delete', branchName], roomPath);
        }
      } catch (e) {
        console.log("Skipped remote branch deletion:", e.message);
      }
      return res.json({ success: true });
    }

    const token = await getGithubToken(uid, req);
    if (token === 'mock_access_token') {
      if (mockRepoBranches[repo]) {
        mockRepoBranches[repo] = mockRepoBranches[repo].filter(b => b !== branchName);
      }
      reposCache.delete(uid);
      return res.json({ success: true });
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      }
    });

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to delete branch`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting branch:", err);
    res.status(500).json({ error: err.message });
  }
});

// 9. Get Repository Details
app.get('/api/github/repos/details', async (req, res) => {
  const { uid, owner, repo } = req.query;
  try {
    const token = await getGithubToken(uid, req);

    if (token === 'mock_access_token') {
      const mockRepo = mockUserRepositories.find(r => r.name === repo);
      if (!mockRepo) return res.status(404).json({ error: 'Repository not found' });
      return res.json(mockRepo);
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'Technify-Cloud-IDE'
      }
    });

    if (!response.ok) throw new Error(`Failed to fetch repository details: ${response.status}`);

    const data = await response.json();
    res.json({
      id: data.id, name: data.name, description: data.description,
      url: data.html_url, private: data.private, default_branch: data.default_branch,
      stargazers_count: data.stargazers_count, forks_count: data.forks_count,
      open_issues_count: data.open_issues_count, language: data.language,
      created_at: data.created_at, updated_at: data.updated_at, pushed_at: data.pushed_at
    });
  } catch (err) {
    console.error("Error fetching repo details:", err);
    res.status(500).json({ error: err.message });
  }
});

// 10. Fetch Pull Requests
app.get('/api/github/repos/prs', async (req, res) => {
  const { uid, owner, repo, state } = req.query;
  try {
    const token = await getGithubToken(uid, req);

    if (token === 'mock_access_token') {
      const mockPRs = [{
        number: 1, title: 'Add new feature', state: 'open',
        user: { login: 'mock-developer' },
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }];
      return res.json(mockPRs.filter(pr => pr.state === (state || 'open')));
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state || 'open'}&per_page=50`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'User-Agent': 'Technify-Cloud-IDE' } }
    );

    if (!response.ok) throw new Error(`Failed to fetch pull requests: ${response.status}`);

    const data = await response.json();
    const filtered = data.map(pr => ({
      number: pr.number, title: pr.title, body: pr.body, state: pr.state,
      user: { login: pr.user.login }, head: { ref: pr.head.ref }, base: { ref: pr.base.ref },
      created_at: pr.created_at, updated_at: pr.updated_at
    }));
    res.json(filtered);
  } catch (err) {
    console.error("Error fetching PRs:", err);
    res.status(500).json({ error: err.message });
  }
});

// 11. Create Pull Request
app.post('/api/github/repos/prs/create', async (req, res) => {
  const { uid, owner, repo, title, body, head, base } = req.body;
  try {
    const token = await getGithubToken(uid, req);

    if (token === 'mock_access_token') {
      return res.json({
        number: Math.floor(Math.random() * 1000), title, body, state: 'open',
        head: { ref: head }, base: { ref: base },
        url: `https://github.com/${owner}/${repo}/pull/1`
      });
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Technify-Cloud-IDE' },
      body: JSON.stringify({ title, body, head, base })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || `Failed to create PR: ${response.status}`);
    }

    const data = await response.json();
    res.json({
      number: data.number, title: data.title, body: data.body, state: data.state,
      head: { ref: data.head.ref }, base: { ref: data.base.ref }, url: data.html_url
    });
  } catch (err) {
    console.error("Error creating PR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 12. Merge Pull Request
app.post('/api/github/repos/prs/merge', async (req, res) => {
  const { uid, owner, repo, prNumber, commitTitle, commitMessage } = req.body;
  try {
    const token = await getGithubToken(uid, req);

    if (token === 'mock_access_token') {
      return res.json({ sha: 'mock_merge_sha_' + Date.now(), merged: true, message: 'Pull request successfully merged' });
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Technify-Cloud-IDE' },
        body: JSON.stringify({ commit_title: commitTitle, commit_message: commitMessage, merge_method: 'squash' })
      }
    );

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || `Failed to merge PR: ${response.status}`);
    }

    const data = await response.json();
    res.json({ sha: data.sha, merged: data.merged, message: data.message });
  } catch (err) {
    console.error("Error merging PR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 13. Delete Repository
app.post('/api/github/repos/delete', async (req, res) => {
  const { uid, owner, repo } = req.body;
  try {
    const token = await getGithubToken(uid, req);

    if (token === 'mock_access_token') {
      const idx = mockUserRepositories.findIndex(r => r.name === repo);
      if (idx >= 0) {
        mockUserRepositories.splice(idx, 1);
        delete mockRepoFiles[repo];
        delete mockRepoBranches[repo];
      }
      reposCache.delete(uid);
      return res.json({ success: true });
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'User-Agent': 'Technify-Cloud-IDE' }
    });

    if (!response.ok && response.status !== 204) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || `Failed to delete repository: ${response.status}`);
    }

    reposCache.delete(uid);
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting repository:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// AI Assistant Streams
// ========================================

app.post('/api/ai/chat', async (req, res) => {
  const { prompt, code, language } = req.body;
  console.log(`[AI Chat] Received request. Prompt length: ${prompt ? prompt.length : 0}, Language: ${language}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[AI Chat] Warning: OPENROUTER_API_KEY is not defined in environment variables.');
    const mockMessage = `⚠️ **OpenRouter API Key is missing on the server!**\n\nTo enable the live AI Assistant, please add \`OPENROUTER_API_KEY=your_key\` to the \`.env\` file in the workspace root, then restart the server.\n\n---\n\n### Mock AI Assistant Response (Vite Mode)\n\nHere is an analysis of your **${language}** code:\n\n\`\`\`${language}\n${code || '// No code provided'}\n\`\`\`\n\n**Suggestions:**\n1. Ensure appropriate error handling for API calls.\n2. Add comments explaining your core logic.\n3. Make sure to export necessary functions or components.`;

    const words = mockMessage.split(' ');
    for (let i = 0; i < words.length; i++) {
      sendEvent({ content: words[i] + (i === words.length - 1 ? '' : ' ') });
      await new Promise(resolve => setTimeout(resolve, 30));
    }

    sendEvent({ done: true });
    res.end();
    return;
  }

  try {
    const systemPrompt = `You are a helpful AI coding assistant in an IDE. 
The user is coding in ${language}.
Here is the current code from the user's editor:
\`\`\`${language}
${code}
\`\`\`

Provide clear, structured, and fully complete answers. 
When writing code solutions, always provide the complete, fully-functional code blocks. Never truncate code blocks, omit sections, or use placeholders like "// Rest of the code here" or "...". Always write the full implementation.
Format your code blocks with language identifiers.`;

    const modelName = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
    console.log(`[AI Chat] Calling OpenRouter API with model: ${modelName}`);

    const responseStream = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      stream: true,
      max_tokens: 8192
    });

    console.log('[AI Chat] OpenRouter connection successful, starting stream transmission...');
    for await (const chunk of responseStream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        sendEvent({ content: text });
      }
    }

    console.log('[AI Chat] Stream transmission completed successfully.');
    sendEvent({ done: true });
    res.end();
  } catch (error) {
    console.error('[AI Chat] Error communicating with OpenRouter API:', error);
    sendEvent({ error: error.message || 'Error occurred while communicating with OpenRouter' });
    res.end();
  }
});

// ========================================
// HTTP Server + WebSocket + Socket.IO
// ========================================

const server = http.createServer(app);

// Import live preview integrated server
import { initLivePreview, handlePreviewUpgrade } from './live-server.js';
initLivePreview(server, app);

// --- y-websocket for Yjs CRDT sync ---
const wss = new WebSocketServer({ noServer: true });

// Handle HTTP upgrade for y-websocket
server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  // Socket.IO handles its own upgrades — skip those
  if (pathname.startsWith('/socket.io')) {
    return;
  }

  // Live preview WS HMR updates - upgrade connection directly
  if (pathname.startsWith('/preview-ws')) {
    handlePreviewUpgrade(request, socket, head);
    return;
  }

  // Authenticate the WebSocket connection
  const authResult = await authenticateWsConnection(request);
  
  if (!authResult.authenticated) {
    console.warn(`[WS] Rejected connection: unauthorized`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Proceed with y-websocket upgrade
  wss.handleUpgrade(request, socket, head, (ws) => {
    // Attach auth info to ws
    ws.authInfo = authResult;
    wss.emit('connection', ws, request);
  });
});

// Import custom y-websocket server (replaces removed bin/utils from y-websocket v3)
import { setupWSConnection } from './yjs-server.js';

wss.on('connection', (ws, req) => {
  setupWSConnection(ws, req);
  const authInfo = ws.authInfo || {};
  console.log(`[Collab] New connection (uid=${authInfo.uid || 'anon'}, room=${authInfo.roomId || 'unknown'}). Total: ${wss.clients.size}`);

  ws.on('close', () => {
    console.log(`[Collab] Disconnected. Total: ${wss.clients.size}`);
  });
});

// --- Socket.IO for room events & presence ---
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  path: '/socket.io'
});

// Track connected users per room
const roomPresence = new Map(); // socketRoom -> Map(socketId -> { uid, name, file, cursor, status, lastActive })

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, uid, name, avatar }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    socket.join(socketRoom);
    socket.roomId = roomId;
    socket.socketRoom = socketRoom;
    socket.uid = uid;
    socket.userName = name;

    if (!roomPresence.has(socketRoom)) {
      roomPresence.set(socketRoom, new Map());
    }
    roomPresence.get(socketRoom).set(socket.id, { 
      uid, 
      name, 
      avatar, 
      file: null, 
      cursor: null, 
      joinedAt: Date.now(),
      status: 'idle',
      lastActive: Date.now()
    });

    // Broadcast updated presence to room
    const presenceList = Array.from(roomPresence.get(socketRoom).values());
    io.to(socketRoom).emit('presence-update', presenceList);

    console.log(`[Socket.IO] ${name} joined room ${socketRoom}. Users: ${presenceList.length}`);
  });

  socket.on('file-opened', ({ roomId, filePath }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    if (roomPresence.has(socketRoom)) {
      const userPresence = roomPresence.get(socketRoom).get(socket.id);
      if (userPresence) {
        userPresence.file = filePath;
        userPresence.status = filePath ? 'viewing' : 'idle';
        userPresence.lastActive = Date.now();
        const presenceList = Array.from(roomPresence.get(socketRoom).values());
        io.to(socketRoom).emit('presence-update', presenceList);
      }
    }
  });

  socket.on('status-change', ({ roomId, status, filePath }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    if (roomPresence.has(socketRoom)) {
      const userPresence = roomPresence.get(socketRoom).get(socket.id);
      if (userPresence) {
        userPresence.status = status;
        if (filePath !== undefined) {
          userPresence.file = filePath;
        }
        userPresence.lastActive = Date.now();
        const presenceList = Array.from(roomPresence.get(socketRoom).values());
        io.to(socketRoom).emit('presence-update', presenceList);
      }
    }
  });

  socket.on('cursor-move', ({ roomId, filePath, line, column }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    if (roomPresence.has(socketRoom)) {
      const userPresence = roomPresence.get(socketRoom).get(socket.id);
      if (userPresence) {
        userPresence.cursor = { line, column };
        userPresence.file = filePath;
        userPresence.lastActive = Date.now();
        if (userPresence.status === 'idle') {
          userPresence.status = 'viewing';
        }
      }
    }
    // Broadcast cursor position to other users in room
    socket.to(socketRoom).emit('remote-cursor', {
      uid: socket.uid,
      name: socket.userName,
      filePath,
      line,
      column
    });
  });

  socket.on('git-activity', ({ roomId, action, details }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    io.to(socketRoom).emit('git-activity', {
      uid: socket.uid,
      name: socket.userName,
      action,
      details,
      timestamp: Date.now()
    });
  });

  socket.on('chat-message', ({ roomId, message }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    io.to(socketRoom).emit('chat-message', message);
  });

  socket.on('timeline-activity', ({ roomId, activity }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    io.to(socketRoom).emit('timeline-activity', activity);
  });

  socket.on('send-notification', ({ roomId, notification }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    io.to(socketRoom).emit('notification', notification);
  });

  socket.on('file-created', ({ roomId, filePath }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    socket.to(socketRoom).emit('file-tree-changed', { action: 'created', filePath });
  });

  socket.on('file-deleted', ({ roomId, filePath }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    socket.to(socketRoom).emit('file-tree-changed', { action: 'deleted', filePath });
  });

  socket.on('file-renamed', ({ roomId, oldPath, newPath }) => {
    const socketRoom = roomId && roomId.startsWith('wp_') ? `project-room-${roomId}` : roomId;
    socket.to(socketRoom).emit('file-tree-changed', { action: 'renamed', oldPath, newPath });
  });

  socket.on('disconnect', () => {
    const socketRoom = socket.socketRoom;
    if (socketRoom && roomPresence.has(socketRoom)) {
      roomPresence.get(socketRoom).delete(socket.id);
      if (roomPresence.get(socketRoom).size === 0) {
        roomPresence.delete(socketRoom);
      } else {
        const presenceList = Array.from(roomPresence.get(socketRoom).values());
        io.to(socketRoom).emit('presence-update', presenceList);
      }
    }
    console.log(`[Socket.IO] Disconnected: ${socket.id}`);
  });
});

// ========================================
// Start Server
// ========================================

server.listen(PORT, () => {
  console.log(`\n🚀 Technify Collab Server v2.0 running on http://localhost:${PORT}`);
  console.log(`   WebSocket (Yjs):  ws://localhost:${PORT}`);
  console.log(`   Socket.IO:        http://localhost:${PORT}/socket.io`);
  console.log(`   REST API:         http://localhost:${PORT}/api\n`);
});
