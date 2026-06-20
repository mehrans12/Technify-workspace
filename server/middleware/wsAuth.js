/**
 * WebSocket Authentication Middleware
 * 
 * Verifies Firebase ID tokens on WebSocket upgrade requests.
 * Falls back to allowing connections in development when Firebase Admin is not configured.
 */

import admin from 'firebase-admin';

let firebaseAdminInitialized = false;

/**
 * Initialize Firebase Admin SDK if credentials are available
 */
export function initFirebaseAdmin() {
  if (firebaseAdminInitialized) return;

  try {
    // Try to initialize with application default credentials or service account
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
      firebaseAdminInitialized = true;
      console.log('[Auth] Firebase Admin initialized with application credentials');
    } else if (process.env.FIREBASE_PROJECT_ID) {
      // Minimal init for token verification (works with project ID only in some environments)
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID
      });
      firebaseAdminInitialized = true;
      console.log('[Auth] Firebase Admin initialized with project ID');
    } else {
      console.log('[Auth] Firebase Admin not configured - WS auth will use permissive mode');
    }
  } catch (err) {
    console.warn('[Auth] Firebase Admin initialization failed:', err.message);
    console.log('[Auth] WebSocket connections will be allowed without token verification');
  }
}

/**
 * Verify a Firebase ID token
 * Returns decoded token claims if valid, null otherwise
 */
export async function verifyFirebaseToken(idToken) {
  if (!firebaseAdminInitialized || !idToken) {
    return null;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (err) {
    console.warn('[Auth] Token verification failed:', err.message);
    return null;
  }
}

/**
 * WebSocket upgrade authentication handler
 * 
 * Extracts auth token from query params and verifies it.
 * In development mode (no Firebase Admin), allows all connections.
 * 
 * @param {http.IncomingMessage} req - The HTTP upgrade request
 * @returns {{ authenticated: boolean, uid: string|null, email: string|null }}
 */
export async function authenticateWsConnection(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const uid = url.searchParams.get('uid');
  const roomId = url.searchParams.get('room') || url.pathname.slice(1);

  // If Firebase Admin is not configured, allow connections in dev mode
  if (!firebaseAdminInitialized) {
    console.log(`[WS Auth] Dev mode: allowing connection for uid=${uid || 'anonymous'} to room=${roomId}`);
    return {
      authenticated: true,
      uid: uid || 'anonymous',
      email: null,
      roomId,
      devMode: true
    };
  }

  // Verify the Firebase ID token
  if (!token) {
    console.warn(`[WS Auth] Connection rejected: no token provided for room=${roomId}`);
    return { authenticated: false, uid: null, email: null, roomId };
  }

  const decoded = await verifyFirebaseToken(token);
  if (!decoded) {
    console.warn(`[WS Auth] Connection rejected: invalid token for room=${roomId}`);
    return { authenticated: false, uid: null, email: null, roomId };
  }

  // Check project membership in Firestore
  if (roomId && roomId.startsWith('wp_')) {
    try {
      const memberDocRef = admin.firestore().collection('WorkspaceMembers').doc(`${roomId}_${decoded.uid}`);
      const memberDoc = await memberDocRef.get();
      if (!memberDoc.exists) {
        console.warn(`[WS Auth] Access denied: User ${decoded.uid} is not a member of project room ${roomId}`);
        return { authenticated: false, uid: decoded.uid, email: decoded.email, roomId };
      }
      console.log(`[WS Auth] Membership verified: User ${decoded.uid} is member of room ${roomId}`);
    } catch (err) {
      console.error(`[WS Auth] Firestore membership check failed for room ${roomId}:`, err.message);
      return { authenticated: false, uid: decoded.uid, email: decoded.email, roomId };
    }
  }

  console.log(`[WS Auth] Authenticated: uid=${decoded.uid}, email=${decoded.email}, room=${roomId}`);
  return {
    authenticated: true,
    uid: decoded.uid,
    email: decoded.email,
    roomId,
    devMode: false
  };
}
