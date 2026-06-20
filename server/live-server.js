import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import esbuild from 'esbuild';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// The workspaces base directory is where room-specific workspaces live
const workspacesDir = path.resolve(__dirname, 'workspaces');

// Ensure workspaces base directory exists
if (!fs.existsSync(workspacesDir)) {
  fs.mkdirSync(workspacesDir, { recursive: true });
}

const PORT = 3000;
const app = express();

// In-memory Virtual File System (VFS) cache: roomId -> { filePath -> fileContent }
const vfs = {};
// Bundled cache: roomId -> { js: '', css: '' }
const compiledCache = {};

// Helper to get room-specific absolute workspace path
function getRoomWorkspacePath(roomId) {
  const safeRoomId = (roomId || 'global').replace(/[^a-zA-Z0-9_\-]/g, '');
  return path.join(workspacesDir, safeRoomId);
}

// Lazy-load a room's file system into VFS
function loadRoomVfs(roomId) {
  if (vfs[roomId]) return; // Already loaded
  vfs[roomId] = {};
  const workspacePath = getRoomWorkspacePath(roomId);
  
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
    // Write a default test index.html for new rooms
    fs.writeFileSync(
      path.join(workspacePath, 'index.html'), 
      getDefaultHtml(roomId), 
      'utf8'
    );
  }
  loadFilesRecursive(workspacePath, workspacePath, vfs[roomId]);
}

function loadFilesRecursive(dir, baseDir, targetObj) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue;
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    
    if (entry.isDirectory()) {
      loadFilesRecursive(fullPath, baseDir, targetObj);
    } else {
      try {
        targetObj[relPath] = fs.readFileSync(fullPath, 'utf8');
      } catch (e) {
        console.error(`[Live Server] Failed to read ${relPath}:`, e.message);
      }
    }
  }
}

// Helper to provide a default starting page
function getDefaultHtml(roomId) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Room Workspace: ${roomId}</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 3rem; }
    h1 { color: #38bdf8; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Welcome to Workspace Room: ${roomId}</h1>
  <p>Modify files in this room via the IDE editor to see them update in real time.</p>
</body>
</html>`;
}

// Extract roomId from request query or Referer header
function getRoomIdFromRequest(req) {
  if (req.query.room) {
    return req.query.room;
  }
  if (req.headers.referer) {
    try {
      const refUrl = new URL(req.headers.referer);
      const room = refUrl.searchParams.get('room');
      if (room) return room;
    } catch (e) {}
  }
  return 'global';
}

// Project Type Detection System
function detectProjectType(roomId) {
  const roomVfs = vfs[roomId] || {};
  const filePaths = Object.keys(roomVfs);
  
  // 1. package.json + react
  if (roomVfs['package.json']) {
    try {
      const pkg = JSON.parse(roomVfs['package.json']);
      if ((pkg.dependencies && (pkg.dependencies.react || pkg.dependencies['react-dom'])) ||
          (pkg.devDependencies && (pkg.devDependencies.react || pkg.devDependencies['react-dom']))) {
        return 'react';
      }
    } catch (e) {}
  }

  // 2. TypeScript App (.ts or .tsx)
  const hasTS = filePaths.some(p => p.endsWith('.ts') || p.endsWith('.tsx'));
  if (hasTS) {
    return 'typescript';
  }

  // 3. React / JSX App
  const hasJSX = filePaths.some(p => p.endsWith('.jsx'));
  if (hasJSX) {
    return 'react';
  }

  // 4. Default Static
  return 'static';
}

// makeVfsPlugin returns an esbuild plugin to compile files directly from memory
const makeVfsPlugin = (roomId) => {
  return {
    name: 'vfs-loader',
    setup(build) {
      // 1. Resolve relative imports inside VFS namespace
      build.onResolve({ filter: /^\.{1,2}\/|^\// }, args => {
        // If it's a relative import but the importer is not from VFS (e.g. it is inside disk node_modules),
        // let esbuild resolve it normally on disk in the default file namespace.
        if (args.importer && args.namespace !== 'vfs') {
          return null;
        }

        let resolvedPath = args.path;
        if (args.path.startsWith('.')) {
          const currentDir = path.dirname(args.importer || '');
          resolvedPath = path.join(currentDir, args.path);
        } else if (args.path.startsWith('/')) {
          resolvedPath = args.path.substring(1);
        }
        
        let vfsKey = resolvedPath.replace(/\\/g, '/');
        if (vfsKey.startsWith('./')) {
          vfsKey = vfsKey.substring(2);
        }

        const roomVfs = vfs[roomId] || {};
        const candidates = [
          vfsKey,
          vfsKey + '.js',
          vfsKey + '.jsx',
          vfsKey + '.ts',
          vfsKey + '.tsx',
          vfsKey + '.css',
          vfsKey + '/index.js',
          vfsKey + '/index.jsx',
          vfsKey + '/index.ts',
          vfsKey + '/index.tsx'
        ];

        for (const cand of candidates) {
          if (roomVfs[cand] !== undefined) {
            return { path: cand, namespace: 'vfs' };
          }
        }
        return { errors: [{ text: `VFS File not found: ${args.path}` }] };
      });

      // 2. Resolve external npm package imports (e.g. 'react', 'react-dom/client')
      // Map them to the physical file namespace so esbuild resolves them normally from disk
      build.onResolve({ filter: /^[^./]/ }, args => {
        try {
          const resolvedPath = require.resolve(args.path, {
            paths: [path.join(__dirname, 'node_modules'), process.cwd()]
          });
          return { path: resolvedPath, namespace: 'file' };
        } catch (e) {
          return { errors: [{ text: `Could not resolve package: ${args.path}. Error: ${e.message}` }] };
        }
      });

      // 3. Load VFS files
      build.onLoad({ filter: /.*/, namespace: 'vfs' }, args => {
        const roomVfs = vfs[roomId] || {};
        const content = roomVfs[args.path] || '';
        const ext = path.extname(args.path).toLowerCase();
        let loader = 'js';
        
        if (ext === '.jsx') loader = 'jsx';
        else if (ext === '.ts') loader = 'ts';
        else if (ext === '.tsx') loader = 'tsx';
        else if (ext === '.css') loader = 'css';
        else if (ext === '.json') loader = 'json';
        else if (ext === '.svg') loader = 'text';

        return {
          contents: content,
          loader: loader
        };
      });
    }
  };
};

// Generates the client-side Live Reload/HMR script
function getLiveClientScript(roomId) {
  return `
<!-- Cloud IDE Live Dev Runtime Reload Script -->
<script>
  (function() {
    const socketUrl = 'ws://' + window.location.host + '/?room=${roomId}';
    let ws;
    let wasDisconnected = false;
    function connect() {
      ws = new WebSocket(socketUrl);
      ws.onopen = () => {
        console.log('[Live Server] Connected to live reload channel for room: ${roomId}');
        if (wasDisconnected) {
          console.log('[Live Server] Reconnected. Refreshing...');
          window.location.reload();
        }
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === 'hmr') {
            if (data.ext === 'css') {
              console.log('[Live Server] HMR: updating stylesheet:', data.file);
              const links = document.querySelectorAll('link[rel="stylesheet"]');
              let found = false;
              for (let link of links) {
                const url = new URL(link.href, window.location.href);
                if (url.pathname.includes(data.file)) {
                  url.searchParams.set('t', Date.now());
                  link.href = url.toString();
                  found = true;
                  break;
                }
              }
              if (!found) {
                window.location.reload();
              }
            } else {
              console.log('[Live Server] HMR fallback: reloading page for:', data.file);
              window.location.reload();
            }
          } else if (data.type === 'reload') {
            window.location.reload();
          }
        } catch (e) {
          if (msg.data === 'reload') {
            window.location.reload();
          }
        }
      };
      ws.onclose = () => {
        console.log('[Live Server] Disconnected from server. Reconnecting...');
        wasDisconnected = true;
        setTimeout(connect, 1000);
      };
    }
    connect();
  })();
</script>
`;
}

// Compiler Error overlay HTML generator
function getCompileErrorHtml(roomId, errorMsg) {
  const escapedErr = errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html>
<head>
  <title>Compilation Error</title>
  <style>
    body { background: #1e1e2e; color: #f38ba8; font-family: Consolas, monospace; padding: 2rem; margin: 0; }
    .container { background: #313244; border-left: 5px solid #f38ba8; padding: 1.5rem; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
    h2 { margin-top: 0; color: #f2cdcd; }
    pre { white-space: pre-wrap; word-break: break-all; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <h2>[Compiler Error] in Room ${roomId}</h2>
    <pre>${escapedErr}</pre>
  </div>
  ${getLiveClientScript(roomId)}
</body>
</html>`;
}

// Main compiler pipeline logic
async function compileRoomIfNeeded(roomId) {
  const roomVfs = vfs[roomId] || {};
  const projectType = detectProjectType(roomId);
  
  if (projectType !== 'react' && projectType !== 'typescript') {
    return; // Static mode, no compilation needed
  }

  // Find index.html to parse script tags
  const htmlContent = roomVfs['index.html'];
  if (!htmlContent) return;

  const scriptMatch = htmlContent.match(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (!scriptMatch) return;

  let entryPoint = scriptMatch[1];
  if (entryPoint.startsWith('/')) {
    entryPoint = entryPoint.substring(1);
  }

  if (!roomVfs[entryPoint]) return;

  // Run esbuild in-memory bundling
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    outfile: 'bundle.js', // Needed for CSS routing paths calculation
    plugins: [makeVfsPlugin(roomId)],
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"development"' },
    sourcemap: 'inline',
    minify: false
  });

  let jsContent = '';
  let cssContent = '';
  
  for (const file of result.outputFiles) {
    if (file.path.endsWith('.js')) {
      jsContent = file.text;
    } else if (file.path.endsWith('.css')) {
      cssContent = file.text;
    }
  }

  compiledCache[roomId] = { js: jsContent, css: cssContent };
}

// Middleware: Route requests to VFS
app.get('*', async (req, res, next) => {
  const roomId = getRoomIdFromRequest(req);
  loadRoomVfs(roomId);

  const roomVfs = vfs[roomId] || {};
  let reqPath = req.path;
  
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }
  
  const vfsKey = reqPath.substring(1); // remove leading slash

  // 1. Compiled outputs serving
  if (reqPath === '/dist/bundle.js') {
    try {
      if (!compiledCache[roomId] || !compiledCache[roomId].js) {
        await compileRoomIfNeeded(roomId);
      }
      if (compiledCache[roomId] && compiledCache[roomId].js) {
        res.setHeader('Content-Type', 'application/javascript');
        return res.send(compiledCache[roomId].js);
      }
    } catch (err) {
      return res.setHeader('Content-Type', 'application/javascript').send(
        `console.error("Compilation error in room: ${roomId}\\n${err.message.replace(/"/g, '\\"')}");`
      );
    }
    return res.status(404).send('Bundle not found');
  }

  if (reqPath === '/dist/bundle.css') {
    if (compiledCache[roomId] && compiledCache[roomId].css) {
      res.setHeader('Content-Type', 'text/css');
      return res.send(compiledCache[roomId].css);
    }
    return res.status(404).send('Bundle CSS not found');
  }

  // 2. Serve HTML pages (with live-reload/Vite-rewrite)
  if (reqPath === '/index.html' || reqPath.endsWith('.html')) {
    let htmlContent = roomVfs[vfsKey];
    if (!htmlContent) {
      return res.status(404).send(`index.html not found in room '${roomId}'`);
    }

    try {
      const projectType = detectProjectType(roomId);
      let finalHtml = htmlContent;

      if (projectType === 'react' || projectType === 'typescript') {
        await compileRoomIfNeeded(roomId);
        
        // Rewrite index.html script tags to point to compiled bundle
        const scriptMatch = htmlContent.match(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>/i);
        if (scriptMatch) {
          finalHtml = finalHtml.replace(scriptMatch[0], `<script type="module" src="/dist/bundle.js"></script>`);
        }

        // Inject link to compile CSS bundle if generated
        if (compiledCache[roomId] && compiledCache[roomId].css) {
          if (finalHtml.includes('</head>')) {
            finalHtml = finalHtml.replace('</head>', `<link rel="stylesheet" href="/dist/bundle.css"></head>`);
          } else {
            finalHtml = `<link rel="stylesheet" href="/dist/bundle.css">` + finalHtml;
          }
        }
      }

      // Inject WS Client Reload script
      const liveClientScript = getLiveClientScript(roomId);
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${liveClientScript}</body>`);
      } else {
        finalHtml += liveClientScript;
      }

      res.setHeader('Content-Type', 'text/html');
      return res.send(finalHtml);
    } catch (compileErr) {
      console.error(`[Compiler Error] Room ${roomId}:`, compileErr.message);
      return res.status(500).send(getCompileErrorHtml(roomId, compileErr.message));
    }
  }

  // 3. Serve standard VFS files
  const fileContent = roomVfs[vfsKey];
  if (fileContent !== undefined) {
    const ext = path.extname(vfsKey).toLowerCase();
    let contentType = 'text/plain';
    if (ext === '.css') contentType = 'text/css';
    else if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.svg') contentType = 'image/svg+xml';
    
    res.setHeader('Content-Type', contentType);
    return res.send(fileContent);
  }

  next();
});

// Fallback static serve for assets physically stored in room folders (if any)
app.use((req, res, next) => {
  const roomId = getRoomIdFromRequest(req);
  const workspacePath = getRoomWorkspacePath(roomId);
  express.static(workspacePath)(req, res, next);
});

const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws, req) => {
  let roomId = 'global';
  try {
    const reqUrl = new URL(req.url, 'http://localhost:3000');
    roomId = reqUrl.searchParams.get('room') || 'global';
  } catch (e) {}

  ws.roomId = roomId;
  clients.add(ws);
  console.log(`[Live Server] Client connected to channel room: ${roomId}. Total clients: ${clients.size}`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[Live Server] Client disconnected. Active clients remaining: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[Live Server] WebSocket client error on room ${roomId}:`, err);
    clients.delete(ws);
  });
});

// Watch workspacesDir with chokidar for modifications
console.log(`[Live Server] Watching workspaces folder: ${workspacesDir}`);
const watcher = chokidar.watch(workspacesDir, {
  ignored: /(^|[\/\\])\../,
  persistent: true,
  ignoreInitial: true
});

// Broadcast file update events to correct websocket clients
function broadcastUpdate(roomId, filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const roomClients = Array.from(clients).filter(c => c.roomId === roomId);
  
  console.log(`[Live Server] Broadcasting file update (${filePath}) to ${roomClients.length} clients in room: ${roomId}`);
  
  const payload = JSON.stringify({
    type: 'hmr',
    file: filePath,
    ext: ext
  });

  roomClients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

watcher.on('all', (event, filePath) => {
  const relToWorkspaces = path.relative(workspacesDir, filePath);
  const parts = relToWorkspaces.split(path.sep);
  if (parts.length < 2) return; // ignore root files

  const roomId = parts[0];
  const fileRelPath = parts.slice(1).join('/');

  // Ensure VFS is initialized for this room
  if (!vfs[roomId]) {
    vfs[roomId] = {};
  }

  // Clear compiled cache for this room since files changed
  delete compiledCache[roomId];

  if (event === 'change' || event === 'add') {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        vfs[roomId][fileRelPath] = fs.readFileSync(filePath, 'utf8');
      }
    } catch (e) {
      console.error(`[Live Server] Failed to update VFS on chokidar event:`, e.message);
    }
  } else if (event === 'unlink') {
    delete vfs[roomId][fileRelPath];
  }

  broadcastUpdate(roomId, fileRelPath);
});

server.listen(PORT, () => {
  console.log(`[Live Server] Hybrid IDE Compiler Dev Runtime listening on http://localhost:${PORT}`);
});
