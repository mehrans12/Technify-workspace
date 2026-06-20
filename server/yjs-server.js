/**
 * Yjs WebSocket Server Utilities
 * 
 * Implements y-websocket server-side connection handling.
 * This replaces the deprecated `y-websocket/bin/utils` from v2.
 * 
 * Handles:
 *   - Document creation and management
 *   - State sync between clients
 *   - Awareness protocol (cursors, presence)
 *   - Optional LevelDB persistence
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { LeveldbPersistence } from 'y-leveldb';
import pathModule from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getRoomWorkspacePath } from './utils/git.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathModule.dirname(__filename);

// Message types
const messageSync = 0;
const messageAwareness = 1;

// Document store
const docs = new Map();

// Persistence setup
const PERSISTENCE_DIR = pathModule.join(__dirname, 'yjs-data');
if (!fs.existsSync(PERSISTENCE_DIR)) {
  fs.mkdirSync(PERSISTENCE_DIR, { recursive: true });
}

let ldbPersistence = null;

try {
  ldbPersistence = new LeveldbPersistence(PERSISTENCE_DIR);
  console.log(`[YjsServer] LevelDB persistence initialized at ${PERSISTENCE_DIR}`);
} catch (err) {
  console.warn('[YjsServer] LevelDB persistence unavailable:', err.message);
  console.log('[YjsServer] Running without persistence - documents will be lost on restart');
}

// Autosave queue
const saveQueues = new Map();

function debouncedSave(roomId, filePath, content) {
  let roomQueue = saveQueues.get(roomId);
  if (!roomQueue) {
    roomQueue = new Map();
    saveQueues.set(roomId, roomQueue);
  }

  if (roomQueue.has(filePath)) {
    clearTimeout(roomQueue.get(filePath));
  }

  const timeout = setTimeout(() => {
    roomQueue.delete(filePath);
    try {
      const workspacePath = getRoomWorkspacePath(roomId);
      const fullPath = pathModule.join(workspacePath, filePath);
      
      // Security: prevent path traversal
      if (!fullPath.startsWith(workspacePath)) {
        console.warn(`[YjsServer] Blocked path traversal attempt: ${filePath} in room ${roomId}`);
        return;
      }

      // Ensure parent directory exists
      const dir = pathModule.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content || '', 'utf8');
      console.log(`[YjsServer] Autosaved ${filePath} to disk for room ${roomId}`);
    } catch (err) {
      console.error(`[YjsServer] Error autosaving ${filePath} for room ${roomId}:`, err);
    }
  }, 1000);

  roomQueue.set(filePath, timeout);
}

/**
 * Get or create a Yjs document for a given room name
 */
async function getYDoc(docName) {
  let doc = docs.get(docName);
  if (doc) return doc;

  doc = new Y.Doc();
  doc.name = docName;
  doc.conns = new Map();
  doc.awareness = new awarenessProtocol.Awareness(doc);

  // Auto-cleanup awareness when client disconnects
  doc.awareness.setLocalState(null);

  // Load persisted state if available
  if (ldbPersistence) {
    try {
      const persistedDoc = await ldbPersistence.getYDoc(docName);
      const persistedState = Y.encodeStateAsUpdate(persistedDoc);
      Y.applyUpdate(doc, persistedState);
      persistedDoc.destroy();
      console.log(`[YjsServer] Loaded persisted state for "${docName}"`);
    } catch (err) {
      console.warn(`[YjsServer] No persisted state for "${docName}":`, err.message);
    }
  }

  // Persist updates
  doc.on('update', async (update, origin) => {
    if (ldbPersistence) {
      try {
        await ldbPersistence.storeUpdate(docName, update);
      } catch (err) {
        console.error(`[YjsServer] Error persisting update for "${docName}":`, err);
      }
    }

    // Broadcast update to all connected clients (except origin)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    doc.conns.forEach((_, conn) => {
      if (conn !== origin) {
        send(conn, message);
      }
    });
  });

  // Broadcast awareness changes
  doc.awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changedClients));
    const message = encoding.toUint8Array(encoder);

    doc.conns.forEach((_, conn) => {
      send(conn, message);
    });
  });

  // Set up deep observer on filesMap to autosave changes to disk
  const filesMap = doc.getMap('files');
  filesMap.observeDeep((events) => {
    events.forEach((event) => {
      if (event.path.length > 0) {
        const filePath = event.path[0];
        const yText = filesMap.get(filePath);
        if (yText instanceof Y.Text) {
          const content = yText.toString();
          debouncedSave(docName, filePath, content);
        }
      }
    });
  });

  docs.set(docName, doc);
  return doc;
}

/**
 * Send a message to a WebSocket connection
 */
function send(conn, message) {
  try {
    if (conn.readyState === 1) { // WebSocket.OPEN
      conn.send(message, (err) => {
        if (err) {
          closeConn(conn);
        }
      });
    }
  } catch (e) {
    closeConn(conn);
  }
}

/**
 * Handle incoming WebSocket message
 */
function messageHandler(conn, doc, message) {
  try {
    const decoder = decoding.createDecoder(new Uint8Array(message));
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case messageSync: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          send(conn, encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
      }
    }
  } catch (err) {
    console.error('[YjsServer] Error handling message:', err);
  }
}

/**
 * Clean up a closed connection
 */
function closeConn(conn) {
  const doc = conn.doc;
  if (!doc) return;

  const controlledIds = doc.conns.get(conn);
  doc.conns.delete(conn);

  if (controlledIds) {
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
  }

  // If no more connections and we have persistence, we can optionally clean up
  if (doc.conns.size === 0) {
    console.log(`[YjsServer] All clients disconnected from "${doc.name}". Document stays in memory.`);
  }
}

/**
 * Set up a new WebSocket connection for Yjs sync
 * This replaces the old setupWSConnection from y-websocket/bin/utils
 */
export async function setupWSConnection(ws, req) {
  // Extract room name from URL path
  const url = new URL(req.url, `http://${req.headers.host}`);
  const docName = url.pathname.slice(1).split('?')[0] || 'default';

  const doc = await getYDoc(docName);
  
  ws.doc = doc;
  doc.conns.set(ws, new Set());

  ws.binaryType = 'arraybuffer';

  ws.on('message', (message) => {
    messageHandler(ws, doc, message);
  });

  ws.on('close', () => {
    closeConn(ws);
  });

  ws.on('error', (err) => {
    console.error(`[YjsServer] WebSocket error:`, err);
    closeConn(ws);
  });

  // Send initial sync step 1
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(ws, encoding.toUint8Array(encoder));
  }

  // Send current awareness states
  const awarenessStates = doc.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(
      doc.awareness,
      Array.from(awarenessStates.keys())
    ));
    send(ws, encoding.toUint8Array(encoder));
  }
}

export { docs, getYDoc };
