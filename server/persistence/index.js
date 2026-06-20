/**
 * Y.Doc Persistence Layer
 * 
 * Uses LevelDB to persist Yjs document state.
 * Documents survive server restarts.
 */

import { LeveldbPersistence } from 'y-leveldb';
import pathModule from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathModule.dirname(__filename);

const PERSISTENCE_DIR = pathModule.join(__dirname, '..', 'yjs-data');

// Ensure persistence directory exists
if (!fs.existsSync(PERSISTENCE_DIR)) {
  fs.mkdirSync(PERSISTENCE_DIR, { recursive: true });
}

let persistence = null;

/**
 * Initialize the LevelDB persistence layer
 */
export async function initPersistence() {
  try {
    persistence = new LeveldbPersistence(PERSISTENCE_DIR);
    console.log(`[Persistence] LevelDB initialized at ${PERSISTENCE_DIR}`);
    return persistence;
  } catch (err) {
    console.error('[Persistence] Failed to initialize LevelDB:', err);
    console.log('[Persistence] Running without persistence - documents will be lost on restart');
    return null;
  }
}

/**
 * Get the persistence instance
 */
export function getPersistence() {
  return persistence;
}

/**
 * Bind a Y.Doc to persistence - loads existing state and auto-saves changes
 */
export async function bindDocToPersistence(docName, ydoc) {
  if (!persistence) return;

  try {
    // Load persisted state into the document
    const persistedYdoc = await persistence.getYDoc(docName);
    const persistedStateVector = Y.encodeStateVector(persistedYdoc);
    const diff = Y.encodeStateAsUpdate(ydoc, persistedStateVector);
    
    // Apply persisted state to the new doc
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));
    
    // Apply any new state from the doc to persistence
    if (diff.length > 0) {
      await persistence.storeUpdate(docName, diff);
    }

    // Listen for future updates and persist them
    ydoc.on('update', async (update) => {
      try {
        await persistence.storeUpdate(docName, update);
      } catch (err) {
        console.error(`[Persistence] Error storing update for ${docName}:`, err);
      }
    });

    console.log(`[Persistence] Document "${docName}" bound to LevelDB`);
  } catch (err) {
    console.error(`[Persistence] Error binding document "${docName}":`, err);
  }
}

export default { initPersistence, getPersistence, bindDocToPersistence };
