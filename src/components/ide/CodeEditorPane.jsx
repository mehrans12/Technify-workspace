import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Code2, Play, Loader, Users, Hash, Wifi, WifiOff, UserPlus, Lock, UserMinus } from 'lucide-react';
import { Form, Button, Modal, InputGroup, OverlayTrigger, Tooltip, Badge, Table } from 'react-bootstrap';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../firebase';
import PresenceBar from './PresenceBar';
import CollaborativePresencePanel from './CollaborativePresencePanel';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  deleteDoc,
  updateDoc,
  addDoc,
  where,
  serverTimestamp 
} from 'firebase/firestore';

const WS_URL = import.meta.env.VITE_COLLAB_WS_URL || 'ws://localhost:4000';

const colors = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#6366f1'
];

function getUserColor(uid) {
  if (!uid) return colors[0];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

export default function CodeEditorPane({ editorRef, language, setLanguage, onRun, isRunning, roomId, setRoomId, activeFile, socket, onFileSelect }) {
  const languages = [
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'html', label: 'HTML' },
    { value: 'css', label: 'CSS' },
    { value: 'python', label: 'Python' },
    { value: 'cpp', label: 'C++' },
    { value: 'c', label: 'C' },
    { value: 'java', label: 'Java' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'php', label: 'PHP' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'csharp', label: 'C#' },
    { value: 'swift', label: 'Swift' },
    { value: 'bash', label: 'Bash' },
    { value: 'sql', label: 'SQL (SQLite)' }
  ];

  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [editor, setEditor] = useState(null);
  const [monaco, setMonaco] = useState(null);
  const [provider, setProvider] = useState(null);
  // roomId and setRoomId are passed as props from Dashboard
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [newRoomId, setNewRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'global';
  });
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [activeUsers, setActiveUsers] = useState([]);
  const [socketPresence, setSocketPresence] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);

  // Safely clean up and transition state when roomId changes
  useEffect(() => {
    setProvider(null);
    yMetaRef.current = null;
    setActiveUsers([]);
    setRepoConnection(null);
    setConnectionStatus('connecting');
  }, [roomId]);

  // Socket.IO presence tracking
  useEffect(() => {
    if (!socket) return;

    const handlePresenceUpdate = (list) => {
      setSocketPresence(list);
    };

    socket.on('presence-update', handlePresenceUpdate);

    return () => {
      socket.off('presence-update', handlePresenceUpdate);
    };
  }, [socket]);

  // Access and Invitations State
  const [hasAccess, setHasAccess] = useState(null); 
  const [isOwner, setIsOwner] = useState(false);
  const [memberRole, setMemberRole] = useState('viewer'); // 'owner' | 'editor' | 'viewer'
  const [inviteRole, setInviteRole] = useState('developer'); // 'lead_developer' | 'developer' | 'viewer'
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [membersList, setMembersList] = useState([]);
  const [repoConnection, setRepoConnection] = useState(null);
  const [lastLoadedFile, setLastLoadedFile] = useState(null);

  const editorTheme = theme === 'dark' ? 'vs-dark' : 'vs';

  const yMetaRef = useRef(null);
  const bindingRef = useRef(null);

  // Set up Yjs Document and WebSocket provider
  useEffect(() => {
    if (!currentUser) return;

    let wsProvider;
    let doc;
    let active = true;

    const initYjs = async () => {
      let token = '';
      try {
        token = await currentUser.getIdToken();
      } catch (e) {
        console.warn("Error getting ID token for Yjs Websocket:", e);
      }

      if (!active) return;

      doc = new Y.Doc();
      wsProvider = new WebsocketProvider(WS_URL, roomId, doc, {
        params: {
          token,
          uid: currentUser.uid,
          room: roomId
        }
      });
      setProvider(wsProvider);

      // Initial status check
      setConnectionStatus(wsProvider.wsconnected ? 'connected' : 'connecting');

      const handleStatus = (event) => {
        setConnectionStatus(event.status); // 'connected', 'connecting', 'disconnected'
      };
      wsProvider.on('status', handleStatus);

      // Metadata ref setup for metadata maps
      const yMeta = doc.getMap('metadata');
      yMetaRef.current = yMeta;

      // Configure Yjs awareness (live cursors, presence & typing)
      const name = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User';
      const color = getUserColor(currentUser?.uid);
      wsProvider.awareness.setLocalStateField('user', {
        uid: currentUser.uid,
        name,
        color,
        status: 'viewing',
        activeFile: null,
        lastActive: Date.now()
      });

      const handleAwarenessChange = () => {
        const states = wsProvider.awareness.getStates();
        const users = [];
        states.forEach((state, clientId) => {
          if (state.user) {
            users.push({
              clientId,
              uid: state.user.uid,
              name: state.user.name,
              color: state.user.color,
              initial: state.user.name.charAt(0).toUpperCase(),
              activeFile: state.user.activeFile,
              status: state.user.status || 'viewing',
              lastActive: state.user.lastActive || Date.now()
            });
          }
        });
        setActiveUsers(users);
      };

      wsProvider.awareness.on('change', handleAwarenessChange);
      // Initial display
      handleAwarenessChange();
    };

    initYjs();

    return () => {
      active = false;
      if (wsProvider) {
        try {
          wsProvider.awareness.setLocalState(null);
        } catch (e) {}
        try {
          wsProvider.destroy();
        } catch (e) {}
      }
      if (doc) {
        try {
          doc.destroy();
        } catch (e) {}
      }
    };
  }, [roomId, currentUser]);

  // Subscribe to available rooms list from Firestore
  useEffect(() => {
    const q = query(collection(db, 'Rooms'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAvailableRooms(list);
    });
    return () => unsubscribe();
  }, []);

  // Verify Room Access & Role Permissions reactively
  useEffect(() => {
    if (!currentUser) return;
    if (roomId === 'global') {
      setHasAccess(true);
      setIsOwner(false);
      setMemberRole('editor');
      return;
    }

    setHasAccess(null); // Loading

    let unsubscribeMember = () => {};

    const roomRef = doc(db, 'Rooms', roomId);
    const unsubscribeRoom = onSnapshot(roomRef, async (roomSnap) => {
      // Clean up previous member subscription if any
      unsubscribeMember();

      if (!roomSnap.exists()) {
        // Room was deleted or does not exist, fall back to global
        setRoomId('global');
        return;
      }

      const roomData = roomSnap.data();
      if (roomData.ownerId === currentUser.uid) {
        setIsOwner(true);
        setMemberRole('owner');
        setHasAccess(true);
        
        const memberRef = doc(db, 'WorkspaceMembers', `${roomId}_${currentUser.uid}`);
        const memberSnap = await getDoc(memberRef);
        if (!memberSnap.exists()) {
          await setDoc(memberRef, {
            workspaceId: roomId,
            userId: currentUser.uid,
            userEmail: currentUser.email,
            userName: currentUser.displayName || currentUser.email.split('@')[0],
            role: 'owner',
            joinedAt: serverTimestamp()
          });
        }
        return;
      }

      const memberRef = doc(db, 'WorkspaceMembers', `${roomId}_${currentUser.uid}`);
      unsubscribeMember = onSnapshot(memberRef, (memberSnap) => {
        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
          setIsOwner(memberData.role === 'owner');
          setMemberRole(memberData.role || 'editor');
          setHasAccess(true);
        } else {
          setIsOwner(false);
          setMemberRole('viewer');
          setHasAccess(false);
        }
      }, (err) => {
        console.error("Error subscribing to member:", err);
        setHasAccess(false);
      });
    }, (err) => {
      console.error("Error subscribing to room:", err);
      setHasAccess(false);
    });

    return () => {
      unsubscribeRoom();
      unsubscribeMember();
    };
  }, [roomId, currentUser]);

  // Subscribe to Repository Connections to automatically load the active file content
  useEffect(() => {
    if (!currentUser || roomId === 'global') return;

    const ref = doc(db, 'RepositoryConnections', roomId);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        const conn = snapshot.data();
        setRepoConnection(conn);
        if (yMetaRef.current) {
          try {
            const currentFile = yMetaRef.current.get('activeFilePath');
            const lastSynced = yMetaRef.current.get('syncedAt');
            const connSyncedTime = conn.syncedAt?.toDate ? conn.syncedAt.toDate().getTime() : (conn.syncedAt ? new Date(conn.syncedAt).getTime() : 0);

            if (currentFile !== conn.activeFilePath || lastSynced !== connSyncedTime) {
              yMetaRef.current.set('activeFilePath', conn.activeFilePath);
              yMetaRef.current.set('syncedAt', connSyncedTime);

              // Overwrite Yjs text for collaboration
              if (provider && provider.doc && !provider.doc.destroyed) {
                const filesMap = provider.doc.getMap('files');
                let yText = filesMap.get(conn.activeFilePath);
                if (!yText) {
                  provider.doc.transact(() => {
                    yText = new Y.Text();
                    filesMap.set(conn.activeFilePath, yText);
                  });
                }
                provider.doc.transact(() => {
                  yText.delete(0, yText.length);
                  yText.insert(0, conn.originalContent || '');
                });
              }

              // Map extension to language
              const ext = conn.activeFilePath.split('.').pop() || '';
              const langMap = {
                'js': 'javascript', 'jsx': 'javascript',
                'ts': 'typescript', 'tsx': 'typescript',
                'html': 'html', 'css': 'css',
                'py': 'python', 'cpp': 'cpp', 'c': 'c',
                'java': 'java', 'go': 'go', 'rs': 'rust',
                'php': 'php', 'rb': 'ruby', 'cs': 'csharp',
                'sh': 'bash', 'sql': 'sql', 'md': 'markdown'
              };
              const mappedLang = langMap[ext.toLowerCase()] || 'javascript';
              setLanguage(mappedLang);
              yMetaRef.current.set('language', mappedLang);
            }
          } catch (e) {
            console.warn("Stale Yjs doc map accessed during room transition:", e);
          }
        }
      } else {
        setRepoConnection(null);
      }
    }, (err) => {
      console.error("Error subscribing to RepositoryConnections:", err);
    });

    return () => unsubscribe();
  }, [roomId, provider, currentUser]);

  // Load room members list for presence and collaboration
  useEffect(() => {
    if (!roomId || roomId === 'global') {
      setMembersList([]);
      return;
    }
    const q = query(collection(db, 'WorkspaceMembers'), where('workspaceId', '==', roomId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMembersList(list);
    }, (err) => {
      console.error("Error loading workspace members:", err);
    });
    return () => unsubscribe();
  }, [roomId]);


  // Handle file selection from FileExplorer & tab switching with multi-file support
  useEffect(() => {
    if (!editor || !monaco) return;

    try {
      if (!activeFile) {
        // Create a default scratch model when no file is active
        const uri = monaco.Uri.file('__scratch__');
        let model = monaco.editor.getModel(uri);
        if (!model) {
          model = monaco.editor.createModel('// Open a file from the explorer to start collaborating!', 'javascript', uri);
        }
        editor.setModel(model);

        if (bindingRef.current) {
          try {
            bindingRef.current.destroy();
          } catch (e) {}
          bindingRef.current = null;
        }

        // Clear active file in awareness
        if (provider && !provider.destroyed) {
          const localState = provider.awareness.getLocalState();
          if (localState && localState.user) {
            provider.awareness.setLocalStateField('user', {
              ...localState.user,
              activeFile: null
            });
          }
        }
        if (socket) {
          socket.emit('file-opened', { roomId, filePath: null });
        }
        return;
      }

      if (!provider || provider.destroyed) return;

      const doc = provider.doc;
      const filesMap = doc.getMap('files');
      const filePath = activeFile.path;

      // 1. Get or create the Y.Text for this file
      let yText = filesMap.get(filePath);
      if (!yText) {
        yText = new Y.Text();
        yText.insert(0, activeFile.content || '');
        doc.transact(() => {
          filesMap.set(filePath, yText);
        });
        console.log(`[Collab] Initialized nested Y.Text for file: ${filePath}`);
      } else {
        // If the file is already in Yjs, check if the content on disk is different
        // and if no other users are editing it, sync from disk (e.g. after a Git checkout/pull)
        const currentYjsContent = yText.toString();
        if (currentYjsContent !== activeFile.content) {
          // Read awareness states directly to find other users editing this file
          const otherEditing = Array.from(provider.awareness.getStates().values()).some(state => 
            state.user && 
            state.user.uid !== currentUser.uid && 
            state.user.activeFile === filePath
          );
          if (!otherEditing) {
            doc.transact(() => {
              yText.delete(0, yText.length);
              yText.insert(0, activeFile.content || '');
            });
            console.log(`[Collab] Synced ${filePath} from disk (content mismatch, no other editors).`);
          }
        }
      }

      // 2. Set the Monaco model
      const uri = monaco.Uri.file(filePath);
      let model = monaco.editor.getModel(uri);
      if (!model) {
        model = monaco.editor.createModel(yText.toString(), activeFile.language || 'plaintext', uri);
      } else {
        // Ensure language is updated if it changed
        if (activeFile.language) {
          monaco.editor.setModelLanguage(model, activeFile.language);
        }
      }
      
      // Switch Monaco editor to this model
      editor.setModel(model);

      // 3. Destroy previous binding
      if (bindingRef.current) {
        try {
          bindingRef.current.destroy();
        } catch (err) {
          console.warn("Error destroying previous binding:", err);
        }
        bindingRef.current = null;
      }

      // 4. Create new MonacoBinding
      try {
        bindingRef.current = new MonacoBinding(
          yText,
          model,
          new Set([editor]),
          provider.awareness
        );
      } catch (err) {
        console.error("Error creating Monaco binding:", err);
      }

      // 5. Update local awareness state with the active file path
      const localState = provider.awareness.getLocalState();
      if (localState && localState.user) {
        provider.awareness.setLocalStateField('user', {
          ...localState.user,
          activeFile: filePath
        });
      }

      // 6. Emit file opened event to Socket.IO if available
      if (socket) {
        socket.emit('file-opened', { roomId, filePath });
      }

      setLastLoadedFile(filePath);
      if (activeFile.language) {
        setLanguage(activeFile.language);
      }
    } catch (e) {
      console.warn("Stale Yjs provider used in active file transition:", e);
    }
  }, [activeFile, editor, monaco, provider, socket, roomId, currentUser]);

  const [showCollabDropdown, setShowCollabDropdown] = useState(false);
  const [showCollabPanel, setShowCollabPanel] = useState(false);
  const dropdownRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const cursorStyleRef = useRef(null);



  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowCollabDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Monitor Monaco content change for typing status (via both Socket.IO and Yjs awareness)
  useEffect(() => {
    if (!editor) return;

    const listener = editor.onDidChangeModelContent(() => {
      try {
        // Broadcast typing status via Yjs awareness (primary, real-time)
        if (provider && !provider.destroyed) {
          const localState = provider.awareness.getLocalState();
          if (localState && localState.user) {
            provider.awareness.setLocalStateField('user', {
              ...localState.user,
              status: 'typing',
              lastActive: Date.now()
            });
          }
        }
      } catch (e) {
        console.warn("Error updating typing status on stale provider:", e);
      }



      // Also broadcast via Socket.IO for the presence bar
      if (socket && roomId) {
        socket.emit('status-change', {
          roomId,
          status: 'editing',
          filePath: activeFile ? activeFile.path : null
        });
      }

      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Revert to viewing after 3 seconds of no typing
      typingTimeoutRef.current = setTimeout(() => {
        try {
          if (provider && !provider.destroyed) {
            const localState = provider.awareness.getLocalState();
            if (localState && localState.user) {
              provider.awareness.setLocalStateField('user', {
                ...localState.user,
                status: activeFile ? 'viewing' : 'idle',
                lastActive: Date.now()
              });
            }
          }
        } catch (e) {
          console.warn("Error resetting typing status timeout on stale provider:", e);
        }
        if (socket && roomId) {
          socket.emit('status-change', {
            roomId,
            status: activeFile ? 'viewing' : 'idle',
            filePath: activeFile ? activeFile.path : null
          });
        }
      }, 3000);
    });

    return () => {
      if (listener) {
        listener.dispose();
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [editor, socket, roomId, activeFile, provider]);

  // Inject dynamic cursor label CSS for each remote user
  useEffect(() => {
    if (!cursorStyleRef.current) {
      const style = document.createElement('style');
      style.id = 'collab-cursor-labels';
      document.head.appendChild(style);
      cursorStyleRef.current = style;
    }

    const remoteUsers = activeUsers.filter(u => u.uid !== currentUser?.uid);
    const css = remoteUsers.map((user, index) => {
      const color = user.color || getUserColor(user.uid);
      // y-monaco uses clientId-based class names for selections/cursors
      return `
        /* Cursor label for ${user.name} */
        .yRemoteSelection-${user.clientId} {
          background-color: ${color}22 !important;
        }
        .yRemoteSelectionHead-${user.clientId} {
          border-color: ${color} !important;
          background-color: ${color} !important;
        }
        .yRemoteSelectionHead-${user.clientId}::after {
          content: '${user.name.replace(/'/g, "\\'")}';
          background-color: ${color} !important;
          color: white;
        }
      `;
    }).join('\n');

    cursorStyleRef.current.textContent = css;

    return () => {
      // Don't remove on cleanup - let it update in-place
    };
  }, [activeUsers, currentUser]);

  // Compute Online/Offline developers
  const presenceData = useMemo(() => {
    if (!roomId || roomId === 'global') {
      const online = socketPresence.map(p => ({
        uid: p.uid,
        name: p.name,
        avatar: p.avatar,
        file: p.file,
        status: p.status || 'viewing',
        lastActive: p.lastActive || Date.now(),
        role: 'member',
        isOnline: true
      }));
      return { online, offline: [], totalOnline: online.length };
    }

    const onlineUids = new Set(socketPresence.map(p => p.uid));
    
    const online = [];
    socketPresence.forEach(p => {
      const member = membersList.find(m => m.userId === p.uid);
      online.push({
        uid: p.uid,
        name: p.name || (member ? member.userName : 'Unknown Developer'),
        avatar: p.avatar || '',
        file: p.file,
        status: p.status || 'viewing',
        lastActive: p.lastActive || Date.now(),
        role: member ? member.role : 'developer',
        isOnline: true
      });
    });

    const offline = [];
    membersList.forEach(m => {
      if (!onlineUids.has(m.userId)) {
        offline.push({
          uid: m.userId,
          name: m.userName,
          avatar: '',
          file: null,
          status: 'offline',
          lastActive: null,
          role: m.role,
          isOnline: false
        });
      }
    });

    return { 
      online, 
      offline, 
      totalOnline: online.length 
    };
  }, [socketPresence, membersList, roomId]);

  function handleEditorDidMount(editorInstance, monacoInstance) {
    setEditor(editorInstance);
    setMonaco(monacoInstance);
    if (editorRef) {
      editorRef.current = editorInstance;
    }
  }

  function handleLanguageChange(e) {
    const newLang = e.target.value;
    setLanguage(newLang);
    if (editor && monaco) {
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, newLang);
      }
    }
  }

  async function handleSwitchRoomSubmit(e) {
    e.preventDefault();
    const cleanRoom = newRoomId.trim().toLowerCase();
    if (cleanRoom && cleanRoom !== roomId) {
      try {
        // Proactively register room in Firestore
        const roomRef = doc(db, 'Rooms', cleanRoom);
        const roomDoc = await getDoc(roomRef);
        if (!roomDoc.exists()) {
          // Create room with ownerId
          await setDoc(roomRef, {
            id: cleanRoom,
            name: cleanRoom,
            createdAt: serverTimestamp(),
            ownerId: currentUser.uid,
            createdBy: currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User'
          });

          // Also register owner in WorkspaceMembers
          const memberRef = doc(db, 'WorkspaceMembers', `${cleanRoom}_${currentUser.uid}`);
          await setDoc(memberRef, {
            workspaceId: cleanRoom,
            userId: currentUser.uid,
            userEmail: currentUser.email,
            userName: currentUser.displayName || currentUser.email.split('@')[0],
            role: 'owner',
            joinedAt: serverTimestamp()
          });

          // Log activity
          await addDoc(collection(db, 'Activities'), {
            userId: currentUser.uid,
            action: 'CREATE_ROOM',
            details: `Created team room #${cleanRoom}`,
            timestamp: serverTimestamp()
          });
        }
      } catch (error) {
        console.error('Error creating room in Firestore:', error);
      }
      setRoomId(cleanRoom);
      setShowRoomModal(false);
    }
  }

  // Handle Member Invitation
  async function handleInviteSubmit(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const emailClean = inviteEmail.trim().toLowerCase();
    
    if (emailClean === currentUser.email.toLowerCase()) {
      alert("You cannot invite yourself!");
      return;
    }

    setIsInviting(true);

    try {
      // Find user by email in Firestore Users
      const usersRef = collection(db, 'Users');
      const q = query(usersRef, where('email', '==', emailClean));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        alert("Developer with this email was not found. They must sign up first!");
        setIsInviting(false);
        return;
      }

      const receiverDoc = querySnapshot.docs[0];
      const receiverData = receiverDoc.data();

      // Check if user is already a member
      const memberRef = doc(db, 'WorkspaceMembers', `${roomId}_${receiverData.uid}`);
      const memberSnap = await getDoc(memberRef);
      if (memberSnap.exists()) {
        alert("This user is already a member of this workspace!");
        setIsInviting(false);
        return;
      }

      // Check if there is an active pending invite
      const invitesRef = collection(db, 'Invitations');
      const inviteQ = query(
        invitesRef,
        where('workspaceId', '==', roomId),
        where('receiverId', '==', receiverData.uid),
        where('status', '==', 'pending')
      );
      const inviteSnap = await getDocs(inviteQ);
      if (!inviteSnap.empty) {
        alert("An invitation is already pending for this user!");
        setIsInviting(false);
        return;
      }

      // Create Invitation
      await addDoc(collection(db, 'Invitations'), {
        workspaceId: roomId,
        workspaceName: roomId,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || currentUser.email.split('@')[0],
        receiverId: receiverData.uid,
        receiverEmail: receiverData.email,
        status: 'pending',
        role: inviteRole,
        createdAt: serverTimestamp()
      });

      // Log to local GitActivity for workspace audit log
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repoConnection?.repoName || 'workspace',
        commitMessage: `Invited user ${emailClean} as ${inviteRole}`,
        actionType: 'invite',
        branchName: repoConnection?.branchName || 'main',
        createdAt: serverTimestamp()
      });

      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'INVITE_USER',
        details: `Invited user ${emailClean} to join team room #${roomId}`,
        timestamp: serverTimestamp()
      });

      alert(`Invitation sent to ${emailClean}!`);
      setInviteEmail('');
      setShowInviteModal(false);
    } catch (err) {
      console.error("Error sending invitation:", err);
      alert("Failed to send invitation. Please try again.");
    } finally {
      setIsInviting(false);
    }
  }

  // Handle Remove Member
  async function handleRemoveMember(memberId, memberUserId) {
    if (memberUserId === currentUser.uid) {
      alert("You cannot remove yourself from your own workspace!");
      return;
    }

    if (!window.confirm("Are you sure you want to remove this member?")) return;

    try {
      const ref = doc(db, 'WorkspaceMembers', memberId);
      const memberSnap = await getDoc(ref);
      const memberData = memberSnap.exists() ? memberSnap.data() : { userName: 'Member', userEmail: '' };

      await deleteDoc(ref);
      
      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'REMOVE_MEMBER',
        details: `Removed user ${memberData.userEmail} from team room #${roomId}`,
        timestamp: serverTimestamp()
      });

      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repoConnection?.repoName || 'workspace',
        commitMessage: `Removed member ${memberData.userName} from workspace`,
        actionType: 'remove-member',
        branchName: repoConnection?.branchName || 'main',
        createdAt: serverTimestamp()
      });

      alert("Member removed successfully!");
    } catch (err) {
      console.error("Error removing member:", err);
      alert("Failed to remove member. Please try again.");
    }
  }

  // Handle Update Member Role
  async function handleUpdateMemberRole(memberDocId, newRole) {
    try {
      const ref = doc(db, 'WorkspaceMembers', memberDocId);
      await updateDoc(ref, { role: newRole });
      
      const memberSnap = await getDoc(ref);
      const memberData = memberSnap.data();
      
      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'UPDATE_ROLE',
        details: `Updated role of user ${memberData.userEmail} in room #${roomId} to ${newRole}`,
        timestamp: serverTimestamp()
      });

      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repoConnection?.repoName || 'workspace',
        commitMessage: `Updated role of member ${memberData.userName} to ${newRole}`,
        actionType: 'role-update',
        branchName: repoConnection?.branchName || 'main',
        createdAt: serverTimestamp()
      });

      alert("Role updated successfully!");
    } catch (err) {
      console.error("Error updating role:", err);
      alert("Failed to update role: " + err.message);
    }
  }

  const renderTooltip = (user) => (
    <Tooltip id={`tooltip-${user.clientId}`}>
      {user.name} {provider && user.clientId === provider.awareness.clientID ? '(You)' : ''}
    </Tooltip>
  );

  const roleCanEdit = roomId === 'global' || memberRole === 'owner' || memberRole === 'lead_developer' || memberRole === 'lead-developer' || memberRole === 'developer' || memberRole === 'editor' || memberRole === 'member';
  const canEdit = roleCanEdit;

  return (
    <div className="h-100 d-flex flex-column" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Editor Toolbar */}
      <div className="workspace-pane-header px-3">
        {/* Left section: title & metadata */}
        <div className="d-flex align-items-center gap-3">
          <div className="workspace-pane-title d-flex align-items-center gap-2 text-truncate" style={{ maxWidth: '300px' }}>
            <span style={{ fontSize: '16px' }}>📄</span>
            <span className="fw-semibold text-truncate" style={{ fontSize: '13px' }}>
              {activeFile ? activeFile.name : (repoConnection ? repoConnection.activeFilePath.split('/').pop() : 'index.js')}
            </span>
            {repoConnection && (
              <span className="text-muted text-truncate" style={{ fontSize: '10.5px' }}>
                ({repoConnection.repoOwner}/{repoConnection.repoName} : {repoConnection.branchName})
              </span>
            )}
          </div>

          <div className="d-flex align-items-center gap-2">
            {/* Room Selector Button */}
            <Button 
              variant="outline-secondary" 
              size="sm" 
              className="d-flex align-items-center px-2 py-1 theme-text-primary border-secondary"
              style={{ fontSize: '11px', height: '26px' }}
              onClick={() => { setNewRoomId(roomId); setShowRoomModal(true); }}
            >
              <Hash size={11} className="me-1 text-warning" />
              {roomId}
            </Button>

            {isOwner && roomId !== 'global' && (
              <Button 
                variant="outline-info" 
                size="sm" 
                className="d-flex align-items-center px-2 py-1 text-info border-info"
                style={{ fontSize: '11px', height: '26px', borderColor: '#00d2ff', color: '#00d2ff' }}
                onClick={() => setShowInviteModal(true)}
              >
                <UserPlus size={11} className="me-1" /> Invite
              </Button>
            )}

            {/* Connection Status Badge */}
            {connectionStatus === 'connecting' && (
              <span className="conn-badge conn-badge-connecting" style={{ height: '26px' }}>
                <span className="conn-dot spinner-rotate" /> Syncing...
              </span>
            )}
            {connectionStatus === 'disconnected' && (
              <span className="conn-badge conn-badge-disconnected" style={{ height: '26px' }}>
                <span className="conn-dot" /> Disconnected
              </span>
            )}
          </div>
        </div>

        {/* Right section: users, language select & run button */}
        <div className="d-flex align-items-center gap-3">
          {/* Collaborators Panel Toggle */}
          <Button
            variant={showCollabPanel ? 'primary' : 'outline-secondary'}
            size="sm"
            className="d-flex align-items-center gap-1 px-2 py-1 theme-text-primary"
            style={{ fontSize: '11px', height: '26px', background: showCollabPanel ? 'var(--accent)' : 'rgba(255,255,255,0.02)', border: showCollabPanel ? 'none' : '1px solid var(--border-subtle)' }}
            onClick={() => setShowCollabPanel(!showCollabPanel)}
            title="Toggle Collaborators Panel"
          >
            <Users size={12} />
          </Button>

          {/* Removed: Collaborators online indicator dropdown */}

          {/* Removed: Active Users Avatars list */}

          <div className="d-flex align-items-center gap-2">
            {/* Language Select Dropdown styled like a Badge */}
            <Form.Select 
              size="sm" 
              value={language} 
              onChange={handleLanguageChange}
              className="custom-select-badge"
              style={{ cursor: 'pointer', minWidth: '100px' }}
            >
              {languages.map(lang => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </Form.Select>

            {/* Run Code Button */}
            <Button 
              onClick={onRun}
              disabled={isRunning}
              className="custom-green-button d-flex align-items-center justify-content-center gap-1.5"
              style={{ whiteSpace: 'nowrap', height: '26px', fontSize: '11px', padding: '4px 12px' }}
            >
              {isRunning ? (
                <><Loader size={12} className="me-1 spinner-rotate" /> Running...</>
              ) : (
                <><Play size={12} fill="currentColor" /> Run Code</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Monaco Editor / Access Denied Block + Presence Panel */}
      <div className="flex-grow-1 d-flex" style={{ minHeight: 0 }}>
        {/* Editor Area */}
        <div className="flex-grow-1 d-flex flex-column" style={{ minWidth: 0 }}>
          {hasAccess === null ? (
            <div className="h-100 flex-grow-1 d-flex align-items-center justify-content-center text-muted" style={{ backgroundColor: '#1a1d24' }}>
              <Loader size={20} className="spinner-rotate me-2" />
              Verifying room access...
            </div>
          ) : hasAccess === false ? (
            <div className="h-100 flex-grow-1 d-flex flex-column align-items-center justify-content-center p-5 text-center" style={{ backgroundColor: '#1a1d24' }}>
              <div className="rounded-circle p-3 mb-3" style={{ backgroundColor: 'rgba(220, 53, 69, 0.1)', color: '#dc3545' }}>
                <Lock size={36} />
              </div>
              <h5 className="fw-bold text-white mb-2">Private Workspace</h5>
              <p className="text-muted small mb-4" style={{ maxWidth: '400px' }}>
                Access to team room <strong className="text-white">#{roomId}</strong> is restricted. 
                Only authorized members invited by the owner can collaborate in this room.
              </p>
              <Button 
                variant="outline-info" 
                size="sm" 
                onClick={() => { setRoomId('global'); }}
                className="rounded-pill px-4"
                style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
              >
                Return to Global Workspace
              </Button>
            </div>
          ) : (
            <>
              <div className="flex-grow-1 position-relative" style={{ minHeight: 0 }}>
                <Editor
                  height="100%"
                  language={language}
                  theme={editorTheme}
                  onMount={handleEditorDidMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    readOnly: !canEdit
                  }}
                />
              </div>
              <PresenceBar presenceList={socketPresence} awarenessUsers={activeUsers} currentUid={currentUser?.uid} />
            </>
          )}
        </div>

        {/* Collaborative Presence Panel (toggleable sidebar) */}
        {showCollabPanel && hasAccess && (
          <CollaborativePresencePanel
            awarenessUsers={activeUsers}
            membersList={membersList}
            currentUid={currentUser?.uid}
            roomId={roomId}
            onFileSelect={onFileSelect}
          />
        )}
      </div>

      {/* Switch Room Modal */}
      <Modal 
        show={showRoomModal} 
        onHide={() => setShowRoomModal(false)} 
        centered 
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant="white" className="border-secondary">
          <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
            <Hash size={20} className="me-2 text-warning" /> Switch Team Room
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSwitchRoomSubmit}>
            <Form.Group className="mb-4">
              <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>CREATE NEW ROOM / JOIN BY ID</Form.Label>
              <InputGroup>
                <InputGroup.Text>#</InputGroup.Text>
                <Form.Control
                  type="text"
                  placeholder="e.g. frontend-team, project-x"
                  value={newRoomId}
                  onChange={(e) => setNewRoomId(e.target.value.replace(/[^a-zA-Z0-9_\-]/g, '').trim().toLowerCase())}
                  autoFocus
                  required
                />
                <Button variant="primary" type="submit" style={{ background: 'var(--primary-gradient)', border: 'none', fontSize: '13px' }}>
                  Join / Create
                </Button>
              </InputGroup>
              <Form.Text className="text-muted" style={{ fontSize: '12px' }}>
                All developers connected to the same room will sync edits, selections, and cursors.
              </Form.Text>
            </Form.Group>
          </Form>

          <div className="border-top border-secondary pt-3 mt-3">
            <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }} className="mb-2">AVAILABLE TEAM ROOMS</Form.Label>
            {availableRooms.length === 0 ? (
              <div className="text-center text-muted py-3 small">No active rooms found.</div>
            ) : (
              <div className="d-flex flex-column gap-2 overflow-auto custom-scrollbar" style={{ maxHeight: '200px' }}>
                {availableRooms.map((room) => (
                  <div 
                    key={room.id} 
                    className="d-flex align-items-center justify-content-between p-2 rounded-3" 
                    style={{ 
                      backgroundColor: room.id === roomId ? 'rgba(102, 126, 234, 0.12)' : 'rgba(255,255,255,0.03)',
                      border: room.id === roomId ? '1px solid var(--accent)' : '1px solid var(--border-subtle)'
                    }}
                  >
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-warning fw-bold">#</span>
                      <div>
                        <span className="fw-bold theme-text-primary small">{room.name}</span>
                        <div className="text-muted" style={{ fontSize: '10px' }}>
                          created by {room.createdBy}
                        </div>
                      </div>
                    </div>
                    {room.id === roomId ? (
                      <Badge bg="success" className="rounded-pill px-2 py-1" style={{ fontSize: '10px' }}>Current</Badge>
                    ) : (
                      <Button 
                        size="sm" 
                        variant="outline-primary" 
                        className="py-1 px-3 rounded-pill" 
                        style={{ fontSize: '11px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                        onClick={() => {
                          setRoomId(room.id);
                          setNewRoomId(room.id);
                          setShowRoomModal(false);
                        }}
                      >
                        Join
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal.Body>
      </Modal>


      {/* Invite Member Modal */}
      <Modal 
        show={showInviteModal} 
        onHide={() => { setShowInviteModal(false); setInviteEmail(''); }} 
        centered 
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant="white" className="border-secondary">
          <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
            <UserPlus size={20} className="me-2 text-info" /> Invite Member to #{roomId}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleInviteSubmit}>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>USER EMAIL</Form.Label>
              <Form.Control
                type="email"
                placeholder="Enter developer's email..."
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                autoFocus
              />
              <Form.Text className="text-muted small">
                The developer must be registered in the system before receiving the invitation.
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>WORKSPACE ROLE</Form.Label>
              <Form.Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ fontSize: '13px' }}
              >
                <option value="lead_developer">Lead Developer (Manage branches & pull & edit)</option>
                <option value="developer">Developer (Edit & commit code)</option>
                <option value="viewer">Viewer (Read-only access)</option>
              </Form.Select>
            </Form.Group>
            <div className="d-flex justify-content-end gap-2 mt-4">
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={() => { setShowInviteModal(false); setInviteEmail(''); }}
              >
                Cancel
              </Button>
              <Button 
                variant="primary" 
                size="sm" 
                type="submit" 
                disabled={isInviting || !inviteEmail.trim()}
                style={{ background: 'var(--primary-gradient)', border: 'none' }}
              >
                {isInviting ? 'Sending Invite...' : 'Send Invitation'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Team Members Modal */}
      <Modal 
        show={showMembersModal} 
        onHide={() => setShowMembersModal(false)} 
        centered 
        size="lg"
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant="white" className="border-secondary">
          <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
            <Users size={20} className="me-2 text-info" /> Team Members in #{roomId}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="table-responsive rounded-3 overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
            <Table hover className="align-middle mb-0">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                  <th className="border-0 text-muted small px-3 py-2">MEMBER</th>
                  <th className="border-0 text-muted small px-3 py-2">ROLE</th>
                  <th className="border-0 text-muted small px-3 py-2 text-end">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {membersList.map(member => (
                  <tr key={member.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-2 fw-semibold">
                      <div className="theme-text-primary">{member.userName}</div>
                      <div className="text-muted small" style={{ fontSize: '11px' }}>{member.userEmail}</div>
                    </td>
                    <td className="px-3 py-2">
                      {member.role === 'owner' ? (
                        <Badge bg="danger" className="py-1 px-2 rounded-pill" style={{ fontSize: '10px' }}>Owner</Badge>
                      ) : isOwner ? (
                        <Form.Select
                          size="sm"
                          value={member.role}
                          onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                          style={{ fontSize: '11px', width: '130px', height: '24px' }}
                        >
                          <option value="lead_developer">Lead Developer</option>
                          <option value="developer">Developer</option>
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor (Legacy)</option>
                        </Form.Select>
                      ) : (
                        <Badge bg="info" className="py-1 px-2 rounded-pill" style={{ fontSize: '10px' }}>
                          {member.role === 'lead_developer' ? 'Lead Dev' : (member.role === 'developer' ? 'Developer' : member.role)}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {member.userId !== currentUser.uid && (
                        <Button 
                          size="sm" 
                          variant="outline-danger"
                          className="d-inline-flex align-items-center gap-1 rounded-pill"
                          style={{ fontSize: '11px' }}
                          onClick={() => handleRemoveMember(member.id, member.userId)}
                        >
                          <UserMinus size={12} /> Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
}
