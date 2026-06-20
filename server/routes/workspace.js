/**
 * Workspace Routes
 * 
 * File system API for workspace file management.
 * Provides listing, reading, writing, creating, and deleting files
 * within room workspace directories.
 */

import { Router } from 'express';
import fs from 'fs';
import pathModule from 'path';
import { getRoomWorkspacePath } from '../utils/git.js';
import { executeLocalCode } from '../utils/executor.js';
import { clearRoomVfs } from '../live-server.js';

const router = Router();

/**
 * GET /api/workspace/files
 * List all files in a workspace directory recursively
 */
router.get('/files', (req, res) => {
  const { roomId } = req.query;
  if (!roomId) {
    return res.status(400).json({ error: 'Missing roomId parameter' });
  }

  const workspacePath = getRoomWorkspacePath(roomId);
  if (!fs.existsSync(workspacePath)) {
    return res.json({ files: [] });
  }

  try {
    const files = listFilesRecursive(workspacePath, workspacePath);
    res.json({ files });
  } catch (err) {
    console.error('[Workspace] Error listing files:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workspace/file
 * Read a single file's content
 */
router.get('/file', (req, res) => {
  const { roomId, path: filePath } = req.query;
  if (!roomId || !filePath) {
    return res.status(400).json({ error: 'Missing roomId or path parameter' });
  }

  const workspacePath = getRoomWorkspacePath(roomId);
  const fullPath = pathModule.join(workspacePath, filePath);

  // Security: prevent path traversal
  if (!fullPath.startsWith(workspacePath)) {
    return res.status(403).json({ error: 'Path traversal not allowed' });
  }

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const stat = fs.statSync(fullPath);
    res.json({
      path: filePath,
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  } catch (err) {
    console.error('[Workspace] Error reading file:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workspace/file
 * Write/create a file in the workspace
 */
router.post('/file', (req, res) => {
  const { roomId, path: filePath, content } = req.body;
  if (!roomId || !filePath) {
    return res.status(400).json({ error: 'Missing roomId or path' });
  }

  const workspacePath = getRoomWorkspacePath(roomId);
  const fullPath = pathModule.join(workspacePath, filePath);

  // Security: prevent path traversal
  if (!fullPath.startsWith(workspacePath)) {
    return res.status(403).json({ error: 'Path traversal not allowed' });
  }

  try {
    // Ensure parent directory exists
    const dir = pathModule.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content || '', 'utf8');
    clearRoomVfs(roomId);
    res.json({ success: true, path: filePath });
  } catch (err) {
    console.error('[Workspace] Error writing file:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workspace/create-file
 * Create a new file (errors if file already exists)
 */
router.post('/create-file', (req, res) => {
  const { roomId, path: filePath, content } = req.body;
  if (!roomId || !filePath) {
    return res.status(400).json({ error: 'Missing roomId or path' });
  }

  const workspacePath = getRoomWorkspacePath(roomId);
  const fullPath = pathModule.join(workspacePath, filePath);

  if (!fullPath.startsWith(workspacePath)) {
    return res.status(403).json({ error: 'Path traversal not allowed' });
  }

  if (fs.existsSync(fullPath)) {
    return res.status(409).json({ error: 'File already exists' });
  }

  try {
    const dir = pathModule.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content || '', 'utf8');
    clearRoomVfs(roomId);
    res.json({ success: true, path: filePath });
  } catch (err) {
    console.error('[Workspace] Error creating file:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workspace/create-folder
 * Create a new folder
 */
router.post('/create-folder', (req, res) => {
  const { roomId, path: folderPath } = req.body;
  if (!roomId || !folderPath) {
    return res.status(400).json({ error: 'Missing roomId or path' });
  }

  const workspacePath = getRoomWorkspacePath(roomId);
  const fullPath = pathModule.join(workspacePath, folderPath);

  if (!fullPath.startsWith(workspacePath)) {
    return res.status(403).json({ error: 'Path traversal not allowed' });
  }

  try {
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    clearRoomVfs(roomId);
    res.json({ success: true, path: folderPath });
  } catch (err) {
    console.error('[Workspace] Error creating folder:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workspace/rename
 * Rename a file or folder
 */
router.post('/rename', (req, res) => {
  const { roomId, oldPath, newPath } = req.body;
  if (!roomId || !oldPath || !newPath) {
    return res.status(400).json({ error: 'Missing roomId, oldPath, or newPath' });
  }

  const workspacePath = getRoomWorkspacePath(roomId);
  const fullOldPath = pathModule.join(workspacePath, oldPath);
  const fullNewPath = pathModule.join(workspacePath, newPath);

  if (!fullOldPath.startsWith(workspacePath) || !fullNewPath.startsWith(workspacePath)) {
    return res.status(403).json({ error: 'Path traversal not allowed' });
  }

  if (!fs.existsSync(fullOldPath)) {
    return res.status(404).json({ error: 'Source path not found' });
  }

  try {
    const newDir = pathModule.dirname(fullNewPath);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }
    fs.renameSync(fullOldPath, fullNewPath);
    clearRoomVfs(roomId);
    res.json({ success: true, oldPath, newPath });
  } catch (err) {
    console.error('[Workspace] Error renaming:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workspace/delete
 * Delete a file or folder
 */
router.post('/delete', (req, res) => {
  const { roomId, path: targetPath } = req.body;
  if (!roomId || !targetPath) {
    return res.status(400).json({ error: 'Missing roomId or path' });
  }

  const workspacePath = getRoomWorkspacePath(roomId);
  const fullPath = pathModule.join(workspacePath, targetPath);

  if (!fullPath.startsWith(workspacePath)) {
    return res.status(403).json({ error: 'Path traversal not allowed' });
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Path not found' });
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    clearRoomVfs(roomId);
    res.json({ success: true, path: targetPath });
  } catch (err) {
    console.error('[Workspace] Error deleting:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Recursively list all files in a directory
 * Ignores .git, node_modules, and hidden directories
 */
function listFilesRecursive(basePath, currentPath, prefix = '') {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  const result = [];

  // Sort: directories first, then files, alphabetically
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    // Skip hidden dirs, node_modules, .git
    if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === '.git') continue;

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = pathModule.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      const children = listFilesRecursive(basePath, fullPath, relativePath);
      result.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children
      });
    } else {
      const stat = fs.statSync(fullPath);
      result.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        size: stat.size,
        extension: pathModule.extname(entry.name).slice(1).toLowerCase()
      });
    }
  }

  return result;
}

/**
 * POST /api/workspace/execute
 * Compile and run code locally in the room's workspace directory
 */
router.post('/execute', async (req, res) => {
  const { roomId, code, language } = req.body;
  if (!roomId || !language) {
    return res.status(400).json({ error: 'Missing roomId or language' });
  }

  try {
    const result = await executeLocalCode(code || '', language, roomId);
    res.json(result);
  } catch (err) {
    console.error('[Workspace API] Execution failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
