import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db } from '../firebase';
import GitHubService from '../services/githubService';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  doc, 
  getDoc,
  getDocs,
  setDoc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  serverTimestamp, 
  limit 
} from 'firebase/firestore';
import { Container, Row, Col, Card, Button, Badge, Spinner, Table, Modal } from 'react-bootstrap';
import { User, Shield, Briefcase, Bell, Clock, Check, X, Award, ExternalLink, AlertCircle, CheckCircle, Settings, Trash2, UserMinus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

const Github = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

// In-app toast notification component
function Toast({ toasts, dismiss }) {
  return (
    <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '360px' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          backgroundColor: t.type === 'success' ? 'rgba(16,185,129,0.15)' : t.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(0,210,255,0.12)',
          border: `1px solid ${t.type === 'success' ? '#10b981' : t.type === 'error' ? '#ef4444' : '#00d2ff'}`,
          borderRadius: '10px', padding: '12px 14px',
          backdropFilter: 'blur(12px)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          animation: 'slideIn 0.25s ease'
        }}>
          {t.type === 'success' ? <CheckCircle size={18} color="#10b981" style={{ flexShrink: 0, marginTop: '1px' }} />
            : t.type === 'error' ? <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />
            : <Github size={18} color="#00d2ff" style={{ flexShrink: 0, marginTop: '1px' }} />}
          <div style={{ flex: 1, fontSize: '13px', color: '#e2e8f0', lineHeight: '1.4' }}>{t.message}</div>
          <button onClick={() => dismiss(t.id)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

export default function Profile() {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [ownedWorkspaces, setOwnedWorkspaces] = useState([]);
  const [joinedWorkspaces, setJoinedWorkspaces] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [activities, setActivities] = useState([]);
  const [githubConn, setGithubConn] = useState(null);
  const [loadingGithub, setLoadingGithub] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [githubPat, setGithubPat] = useState('');
  const [connectingPat, setConnectingPat] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Room Management States
  const [showManageModal, setShowManageModal] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomMembers, setRoomMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Toast notification system
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);
  const dismissToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // Fetch users details
  useEffect(() => {
    if (!currentUser) return;
    const userRef = doc(db, 'Users', currentUser.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        setProfile(snapshot.data());
      }
      setLoadingProfile(false);
    }, (err) => {
      console.error("Error fetching profile:", err);
      setLoadingProfile(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Fetch GitHub Connection Status
  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'GitHubConnections', currentUser.uid);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        setGithubConn(snapshot.data());
      } else {
        setGithubConn(null);
      }
      setLoadingGithub(false);
    }, (err) => {
      console.error("Error loading github connection:", err);
      setLoadingGithub(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Handle incoming GitHub OAuth redirect parameters
  useEffect(() => {
    if (!currentUser) return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('error');
    const username = params.get('github_username');
    const avatar = params.get('github_avatar');
    const id = params.get('github_id');
    const repos = params.get('github_repos');
    const encryptedToken = params.get('encrypted_token');

    if (connected === 'github' && username && encryptedToken) {
      const saveConnection = async () => {
        try {
          const now = new Date().toISOString();
          // Write directly to Firestore using client SDK (authenticated)
          await setDoc(doc(db, 'GitHubConnections', currentUser.uid), {
            githubConnected: true,
            githubId: parseInt(id) || 0,
            githubUsername: username,
            githubAvatar: avatar,
            githubConnectedAt: now,
            githubPublicRepos: parseInt(repos) || 0,
            accessToken: encryptedToken,
            connectionType: 'oauth',
            userId: currentUser.uid
          });

          // Log user activity
          await addDoc(collection(db, 'Activities'), {
            userId: currentUser.uid,
            action: 'CONNECT_GITHUB',
            details: `Connected GitHub account @${username} via OAuth`,
            timestamp: serverTimestamp()
          });

          console.log(`[Profile] GitHub OAuth success — connected as @${username}`);
          toast(`GitHub account @${username} connected successfully!`, 'success');
        } catch (err) {
          console.error('[Profile] Error saving GitHub connection in Firestore:', err);
          toast(`Failed to store GitHub connection: ${err.message}`, 'error');
        }
        navigate('/profile', { replace: true });
      };
      saveConnection();
    } else if (error) {
      console.error('[Profile] GitHub OAuth error:', error);
      toast('Failed to connect GitHub: ' + decodeURIComponent(error), 'error');
      navigate('/profile', { replace: true });
    }
  }, [currentUser]);

  // Handle Disconnect GitHub — deletes document from Firestore and notifies backend
  async function handleDisconnectGithub() {
    if (disconnecting) return;
    setShowDisconnectConfirm(false);
    setDisconnecting(true);
    try {
      // 1. Delete document directly on the client side
      await deleteDoc(doc(db, 'GitHubConnections', currentUser.uid));

      // 2. Call backend disconnect as a dummy notification
      await fetch(`${SERVER_URL}/api/github/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: currentUser.uid })
      });

      // 3. Log activity in Firestore
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'DISCONNECT_GITHUB',
        details: `Disconnected GitHub account @${githubConn?.githubUsername || 'unknown'}`,
        timestamp: serverTimestamp()
      });

      toast(`GitHub account disconnected successfully.`, 'success');
    } catch (err) {
      console.error('Disconnect error:', err);
      toast('Failed to disconnect: ' + err.message, 'error');
    } finally {
      setDisconnecting(false);
    }
  }

  // Handle Connect OAuth — redirects to GitHub authorization page
  function handleConnectOAuth() {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      GitHubService.initiateOAuthLogin(currentUser.uid);
    } catch (err) {
      console.error(err);
      toast('Failed to initiate GitHub OAuth: ' + err.message, 'error');
      setActionInProgress(false);
    }
  }

  // Handle Connect PAT
  async function handleConnectPat(e) {
    e.preventDefault();
    if (!githubPat.trim() || connectingPat) return;
    setConnectingPat(true);
    try {
      const data = await GitHubService.connectWithPAT(currentUser.uid, githubPat.trim());

      // Save connection directly to Firestore (authenticated client side)
      await setDoc(doc(db, 'GitHubConnections', currentUser.uid), {
        githubConnected: true,
        githubId: data.githubId,
        githubUsername: data.githubUsername,
        githubAvatar: data.githubAvatar,
        githubConnectedAt: data.githubConnectedAt,
        githubPublicRepos: data.githubPublicRepos,
        accessToken: data.encryptedToken,
        connectionType: data.connectionType,
        userId: currentUser.uid
      });

      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'CONNECT_GITHUB',
        details: `Connected GitHub account @${data.githubUsername} via PAT`,
        timestamp: serverTimestamp()
      });

      toast(`GitHub account @${data.githubUsername} connected via PAT!`, 'success');
      setGithubPat('');
    } catch (err) {
      console.error(err);
      toast('PAT connection failed: ' + err.message, 'error');
    } finally {
      setConnectingPat(false);
    }
  }

  // Subscribe to room members
  useEffect(() => {
    if (!selectedRoom || !showManageModal) {
      setRoomMembers([]);
      return;
    }

    setLoadingMembers(true);
    const q = query(
      collection(db, 'WorkspaceMembers'),
      where('workspaceId', '==', selectedRoom.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRoomMembers(list);
      setLoadingMembers(false);
    }, (err) => {
      console.error("Error loading room members:", err);
      setLoadingMembers(false);
    });

    return () => unsubscribe();
  }, [selectedRoom, showManageModal]);

  // Open manage modal
  function handleOpenManageModal(room) {
    setSelectedRoom(room);
    setShowManageModal(true);
  }

  // Remove member from workspace/room (only allowed for owner)
  async function handleRemoveMember(member) {
    if (!selectedRoom) return;
    if (member.role === 'owner' || member.userId === currentUser.uid) {
      toast("You cannot remove yourself or another owner.", "error");
      return;
    }

    const confirmRemove = window.confirm(`Are you sure you want to remove ${member.userName || member.userEmail} from this team room?`);
    if (!confirmRemove) return;

    try {
      // Delete from WorkspaceMembers
      await deleteDoc(doc(db, 'WorkspaceMembers', `${selectedRoom.id}_${member.userId}`));
      
      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'REMOVE_MEMBER',
        details: `Removed member ${member.userName || member.userEmail} from room #${selectedRoom.name}`,
        timestamp: serverTimestamp()
      });

      toast(`Successfully removed ${member.userName || member.userEmail} from the room.`, "success");
    } catch (err) {
      console.error("Error removing member:", err);
      toast("Failed to remove member: " + err.message, "error");
    }
  }

  // Delete team room (only allowed for owner)
  async function handleDeleteRoom() {
    if (!selectedRoom) return;
    
    const confirmDelete = window.confirm(`WARNING: Are you sure you want to permanently delete the team room #${selectedRoom.name}? This will remove all member permissions, repository connections, and delete the room itself.`);
    if (!confirmDelete) return;

    try {
      const roomId = selectedRoom.id;
      const roomName = selectedRoom.name;

      // 1. Close modal first
      setShowManageModal(false);
      setSelectedRoom(null);

      // Reset activeRoom localStorage if we deleted the current active room
      if (localStorage.getItem('activeRoom') === roomId) {
        localStorage.setItem('activeRoom', 'global');
      }

      // 2. Delete the room document
      await deleteDoc(doc(db, 'Rooms', roomId));

      // 3. Delete all membership documents for this room
      const membersQuery = query(
        collection(db, 'WorkspaceMembers'),
        where('workspaceId', '==', roomId)
      );
      const membersSnapshot = await getDocs(membersQuery);
      const deletePromises = membersSnapshot.docs.map(memberDoc => 
        deleteDoc(doc(db, 'WorkspaceMembers', memberDoc.id))
      );
      await Promise.all(deletePromises);

      // 4. Delete RepositoryConnection if any
      await deleteDoc(doc(db, 'RepositoryConnections', roomId));

      // 5. Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'DELETE_ROOM',
        details: `Deleted team room #${roomName}`,
        timestamp: serverTimestamp()
      });

      toast(`Successfully deleted team room #${roomName}.`, "success");
    } catch (err) {
      console.error("Error deleting room:", err);
      toast("Failed to delete room: " + err.message, "error");
    }
  }

  // Fetch owned workspaces
  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'Rooms'), where('ownerId', '==', currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate() : (a.createdAt ? new Date(a.createdAt) : 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : 0);
        return tB - tA;
      });
      setOwnedWorkspaces(list);
    }, (err) => {
      console.error("Error fetching owned rooms:", err);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Fetch joined workspaces
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'WorkspaceMembers'), 
      where('userId', '==', currentUser.uid), 
      where('role', '==', 'member')
    );
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      try {
        const joinedList = [];
        for (const memberDoc of snapshot.docs) {
          const data = memberDoc.data();
          const roomRef = doc(db, 'Rooms', data.workspaceId);
          const roomSnap = await getDoc(roomRef);
          if (roomSnap.exists()) {
            joinedList.push({ id: roomSnap.id, ...roomSnap.data(), joinedAt: data.joinedAt });
          }
        }
        setJoinedWorkspaces(joinedList);
      } catch (e) {
        console.error("Error joining workspaces resolve:", e);
      }
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Fetch pending invitations
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'Invitations'), 
      where('receiverId', '==', currentUser.uid)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(invite => invite.status === 'pending');
      
      list.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate() : (a.createdAt ? new Date(a.createdAt) : 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : 0);
        return tB - tA;
      });

      setPendingInvites(list);
      setLoadingInvites(false);
    }, (err) => {
      console.error("Error fetching invites:", err);
      setLoadingInvites(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Fetch recent activities
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'Activities'),
      where('userId', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => {
        const tA = a.timestamp?.toDate ? a.timestamp.toDate() : (a.timestamp ? new Date(a.timestamp) : 0);
        const tB = b.timestamp?.toDate ? b.timestamp.toDate() : (b.timestamp ? new Date(b.timestamp) : 0);
        return tB - tA;
      });
      setActivities(list.slice(0, 8));
    }, (err) => {
      console.error("Error fetching activities:", err);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Accept Invitation Flow
  async function handleAcceptInvite(invite) {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      const memberRef = doc(db, 'WorkspaceMembers', `${invite.workspaceId}_${currentUser.uid}`);
      await setDoc(memberRef, {
        workspaceId: invite.workspaceId,
        userId: currentUser.uid,
        userEmail: currentUser.email,
        userName: profile?.displayName || currentUser.email.split('@')[0],
        role: invite.role || 'editor',
        joinedAt: serverTimestamp()
      });
      const inviteRef = doc(db, 'Invitations', invite.id);
      await updateDoc(inviteRef, { status: 'accepted', updatedAt: serverTimestamp() });
      
      // Log to workspace GitActivity for local audit log
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: invite.workspaceId,
        userId: currentUser.uid,
        username: profile?.displayName || currentUser.email.split('@')[0],
        repoName: 'workspace',
        commitMessage: `Joined the workspace room as ${invite.role || 'editor'}`,
        actionType: 'join',
        branchName: 'main',
        createdAt: serverTimestamp()
      });

      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'JOIN_ROOM',
        details: `Accepted invite to join team room #${invite.workspaceId}`,
        timestamp: serverTimestamp()
      });
      toast(`Joined Team Room #${invite.workspaceId} successfully!`, 'success');
    } catch (error) {
      console.error('Error accepting invite:', error);
      toast('Failed to accept invitation. Please try again.', 'error');
    } finally {
      setActionInProgress(false);
    }
  }

  // Reject Invitation Flow
  async function handleRejectInvite(invite) {
    if (actionInProgress) return;
    setActionInProgress(true);
    try {
      const inviteRef = doc(db, 'Invitations', invite.id);
      await updateDoc(inviteRef, { status: 'rejected', updatedAt: serverTimestamp() });
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'REJECT_INVITE',
        details: `Declined invite to join team room #${invite.workspaceId}`,
        timestamp: serverTimestamp()
      });
      toast('Invitation declined.', 'info');
    } catch (error) {
      console.error('Error rejecting invite:', error);
    } finally {
      setActionInProgress(false);
    }
  }

  const formatActivityTime = (timestamp) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' +
           date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getInitials = () => {
    if (profile?.displayName) {
      return profile.displayName.charAt(0).toUpperCase();
    }
    return currentUser?.email?.charAt(0).toUpperCase() || 'U';
  };

  if (loadingProfile) {
    return (
      <div className="h-100 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'var(--bg-dark)' }}>
        <Spinner animation="border" variant="info" />
      </div>
    );
  }

  return (
    <>
      {/* Toast Notification Overlay */}
      <Toast toasts={toasts} dismiss={dismissToast} />

      <Container fluid className="py-4" style={{ backgroundColor: 'var(--bg-dark)' }}>
        <Row className="gy-4">
          {/* Left Side: Profile Card & Activity */}
          <Col lg={4}>
          <Card className="border-0 shadow-sm mb-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle) !important', borderRadius: '12px' }}>
            <Card.Body className="text-center p-4">
              <div 
                className="mx-auto rounded-circle d-flex align-items-center justify-content-center mb-3 text-white fw-bold shadow-lg"
                style={{ 
                  width: '90px', 
                  height: '90px', 
                  fontSize: '32px',
                  background: 'var(--primary-gradient)',
                  border: '4px solid var(--border-subtle)'
                }}
              >
                {getInitials()}
              </div>
              <h4 className="fw-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                {profile?.displayName || 'Developer'}
              </h4>
              <p className="text-muted small mb-3">{currentUser?.email}</p>
              
              <div className="d-flex align-items-center justify-content-center gap-2 mb-4">
                <Badge bg="info" className="d-flex align-items-center gap-1 py-2 px-3 rounded-pill" style={{ fontSize: '11px' }}>
                  <Shield size={12} />
                  <span>{profile?.role || 'Developer'}</span>
                </Badge>
                <Badge bg={theme === 'dark' ? 'dark' : 'light'} className="border border-secondary py-2 px-3 rounded-pill" style={{ fontSize: '11px', color: 'var(--text-primary)' }}>
                  Active User
                </Badge>
              </div>

              <hr style={{ borderColor: 'var(--border-subtle)' }} />

              <div className="text-start mt-3">
                <div className="d-flex justify-content-between mb-2">
                  <span className="text-muted small">Account Created</span>
                  <span className="text-light small fw-semibold" style={{ color: 'var(--text-primary) !important' }}>
                    {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                  </span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="text-muted small">Created Rooms</span>
                  <span className="text-light small fw-bold" style={{ color: 'var(--text-primary) !important' }}>{ownedWorkspaces.length}</span>
                </div>
                <div className="d-flex justify-content-between">
                  <span className="text-muted small">Joined Teams</span>
                  <span className="text-light small fw-bold" style={{ color: 'var(--text-primary) !important' }}>{joinedWorkspaces.length}</span>
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Connected Accounts — GitHub */}
          <Card className="border-0 shadow-sm mb-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle) !important', borderRadius: '12px' }}>
            <Card.Header className="bg-transparent border-0 pt-4 px-4 pb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h6 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Github size={16} color="var(--accent)" />
                Connected Accounts
              </h6>
            </Card.Header>
            <Card.Body className="px-4 pb-4 pt-3">
              {loadingGithub ? (
                <div className="text-center py-4">
                  <Spinner animation="border" size="sm" variant="info" />
                  <p className="text-muted small mt-2 mb-0">Checking connection...</p>
                </div>
              ) : githubConn ? (
                /* === CONNECTED STATE === */
                <div className="d-flex flex-column gap-3">
                  {/* Avatar + Info Row */}
                  <div className="p-3 rounded-3" style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)'
                  }}>
                    <div className="d-flex align-items-center gap-3 mb-3">
                      <div style={{ position: 'relative' }}>
                        <img
                          src={githubConn.githubAvatar || githubConn.githubAvatarUrl}
                          alt={`@${githubConn.githubUsername}`}
                          className="rounded-circle"
                          style={{ width: '52px', height: '52px', border: '2px solid #238636', objectFit: 'cover' }}
                          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${githubConn.githubUsername}&background=238636&color=fff`; }}
                        />
                        <span style={{
                          position: 'absolute', bottom: 0, right: 0,
                          width: '14px', height: '14px', backgroundColor: '#238636',
                          borderRadius: '50%', border: '2px solid var(--bg-card)'
                        }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <span className="fw-bold" style={{ color: 'var(--text-primary)', fontSize: '14px' }}>@{githubConn.githubUsername}</span>
                          <Badge style={{ backgroundColor: 'rgba(35,134,54,0.2)', color: '#3fb950', border: '1px solid rgba(35,134,54,0.4)', fontSize: '10px' }}>
                            Connected
                          </Badge>
                          {githubConn.connectionType === 'pat' && (
                            <Badge style={{ backgroundColor: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.4)', fontSize: '10px' }}>PAT</Badge>
                          )}
                          {githubConn.connectionType === 'oauth' && (
                            <Badge style={{ backgroundColor: 'rgba(0,210,255,0.12)', color: '#00d2ff', border: '1px solid rgba(0,210,255,0.3)', fontSize: '10px' }}>OAuth</Badge>
                          )}
                        </div>
                        <div className="text-muted" style={{ fontSize: '11px' }}>
                          {githubConn.githubEmail && <span>{githubConn.githubEmail} · </span>}
                          {githubConn.githubPublicRepos != null && <span>{githubConn.githubPublicRepos} public repos</span>}
                        </div>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="d-flex gap-3" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {githubConn.githubFollowers != null && (
                        <span><strong style={{ color: 'var(--text-primary)' }}>{githubConn.githubFollowers}</strong> followers</span>
                      )}
                      <span>
                        Connected {githubConn.githubConnectedAt
                          ? new Date(githubConn.githubConnectedAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
                          : 'recently'}
                      </span>
                    </div>

                    {/* External link */}
                    <a
                      href={`https://github.com/${githubConn.githubUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="d-inline-flex align-items-center gap-1 mt-2"
                      style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}
                    >
                      View on GitHub <ExternalLink size={10} />
                    </a>
                  </div>

                  {/* Disconnect — inline confirm */}
                  {!showDisconnectConfirm ? (
                    <Button
                      variant="outline-danger"
                      size="sm"
                      className="rounded-pill w-100"
                      style={{ fontSize: '12px', padding: '6px 0' }}
                      onClick={() => setShowDisconnectConfirm(true)}
                      disabled={disconnecting}
                    >
                      {disconnecting ? (
                        <><Spinner size="sm" animation="border" className="me-2" />Disconnecting...</>
                      ) : 'Disconnect GitHub Account'}
                    </Button>
                  ) : (
                    <div className="p-3 rounded-3" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                      <p className="small mb-2 text-danger">
                        Are you sure you want to disconnect <strong>@{githubConn.githubUsername}</strong>? You will lose access to GitHub features.
                      </p>
                      <div className="d-flex gap-2">
                        <Button variant="danger" size="sm" className="rounded-pill px-3 flex-fill"
                          style={{ fontSize: '11px' }} onClick={handleDisconnectGithub} disabled={disconnecting}>
                          {disconnecting ? <Spinner size="sm" animation="border" /> : 'Yes, Disconnect'}
                        </Button>
                        <Button variant="outline-secondary" size="sm" className="rounded-pill px-3 flex-fill"
                          style={{ fontSize: '11px' }} onClick={() => setShowDisconnectConfirm(false)} disabled={disconnecting}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* === NOT CONNECTED STATE === */
                <div className="d-flex flex-column gap-3">
                  {/* Primary: OAuth */}
                  <div className="p-3 rounded-3" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)' }}>
                    <div className="d-flex align-items-center gap-2 mb-2">
                      <Github size={15} color="var(--text-primary)" />
                      <span className="fw-bold theme-text-primary" style={{ fontSize: '13px' }}>Connect GitHub Account</span>
                    </div>
                    <p className="text-muted mb-3" style={{ fontSize: '11.5px', lineHeight: '1.5' }}>
                      Authorize with GitHub OAuth to access repos, create branches, commit code, and deploy directly from the IDE.
                    </p>
                    <Button
                      id="btn-connect-github-oauth"
                      size="sm"
                      className="w-100 rounded-pill fw-semibold d-flex align-items-center justify-content-center gap-2"
                      style={{
                        backgroundColor: '#238636', borderColor: '#238636', color: '#ffffff',
                        fontSize: '12px', padding: '8px 0', transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#2ea043'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = '#238636'}
                      onClick={handleConnectOAuth}
                      disabled={actionInProgress}
                    >
                      {actionInProgress ? (
                        <><Spinner size="sm" animation="border" className="me-2" />Redirecting to GitHub...</>
                      ) : (
                        <><Github size={14} color="#fff" /> Connect with GitHub</>  
                      )}
                    </Button>
                  </div>

                  {/* Separator */}
                  <div className="d-flex align-items-center gap-2">
                    <hr style={{ flex: 1, borderColor: 'var(--border-subtle)', margin: 0 }} />
                    <span className="text-muted" style={{ fontSize: '10px' }}>OR</span>
                    <hr style={{ flex: 1, borderColor: 'var(--border-subtle)', margin: 0 }} />
                  </div>

                  {/* Fallback: PAT */}
                  <div className="p-3 rounded-3" style={{ backgroundColor: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-subtle)' }}>
                    <div className="fw-semibold mb-1" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Personal Access Token</div>
                    <p className="text-muted mb-3" style={{ fontSize: '11px' }}>
                      Paste a token with <code style={{ color: '#f0883e', background: 'rgba(240,136,62,0.1)', padding: '1px 4px', borderRadius: '3px' }}>repo</code> scope as a fallback.
                    </p>
                    <form onSubmit={handleConnectPat} className="d-flex flex-column gap-2">
                      <input
                        id="github-pat-input"
                        type="password"
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        value={githubPat}
                        onChange={(e) => setGithubPat(e.target.value)}
                        className="form-control form-control-sm"
                        style={{ fontSize: '12px' }}
                        required
                        disabled={connectingPat}
                      />
                      <Button
                        type="submit"
                        variant="outline-secondary"
                        size="sm"
                        className="rounded-pill align-self-start px-3 py-1"
                        style={{ fontSize: '11px', color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}
                        disabled={connectingPat || !githubPat.trim()}
                      >
                        {connectingPat ? <><Spinner size="sm" animation="border" className="me-1" />Validating...</> : 'Connect with Token'}
                      </Button>
                    </form>
                  </div>
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Recent Activity */}
          <Card className="border-0 shadow-sm" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle) !important', borderRadius: '12px' }}>
            <Card.Header className="bg-transparent border-0 pt-4 px-4 pb-2">
              <h6 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Clock size={16} className="text-warning" />
                Recent Activity
              </h6>
            </Card.Header>
            <Card.Body className="px-4 pb-4 pt-2">
              {activities.length === 0 ? (
                <p className="text-muted small my-3 text-center">No recent activities logged.</p>
              ) : (
                <div className="activity-timeline mt-2" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  {activities.map((act) => (
                    <div key={act.id} className="d-flex gap-3 mb-3 border-left-custom" style={{ paddingLeft: '8px', borderLeft: '2px solid var(--border-subtle)' }}>
                      <div>
                        <div className="small fw-semibold" style={{ color: 'var(--text-primary)', fontSize: '12.5px' }}>{act.details}</div>
                        <div className="text-muted" style={{ fontSize: '10.5px' }}>{formatActivityTime(act.timestamp)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* Right Side: Workspaces & Invites */}
        <Col lg={8}>
          {/* Pending Invitations Section */}
          <Card className="border-0 shadow-sm mb-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle) !important', borderRadius: '12px' }}>
            <Card.Header className="bg-transparent border-0 pt-4 px-4 pb-1">
              <h5 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Bell size={18} className="text-danger animate-pulse" />
                Pending Team Room Invites
              </h5>
            </Card.Header>
            <Card.Body className="p-4">
              {loadingInvites ? (
                <div className="text-center py-4"><Spinner animation="border" size="sm" variant="info" /></div>
              ) : pendingInvites.length === 0 ? (
                <div className="text-center py-4 rounded-3" style={{ border: '1px dashed var(--border-subtle)', backgroundColor: 'rgba(255,255,255,0.01)' }}>
                  <p className="text-muted mb-0 small">You have no pending invitations.</p>
                </div>
              ) : (
                <Row className="gy-3">
                  {pendingInvites.map((invite) => (
                    <Col md={12} key={invite.id}>
                      <div 
                        className="p-3 rounded-3 d-flex align-items-center justify-content-between border border-secondary"
                        style={{ backgroundColor: 'rgba(0, 210, 255, 0.03)', borderColor: 'var(--border-subtle)' }}
                      >
                        <div>
                          <div className="fw-bold text-white mb-1" style={{ color: 'var(--text-primary) !important', fontSize: '14px' }}>
                            Invitation to join <span style={{ color: 'var(--accent)' }}>#{invite.workspaceId}</span>
                          </div>
                          <div className="text-muted small">
                            Invited by <strong className="text-white" style={{ color: 'var(--text-primary) !important' }}>{invite.senderName}</strong>
                          </div>
                        </div>

                        <div className="d-flex gap-2">
                          <Button 
                            variant="success" 
                            size="sm"
                            className="d-flex align-items-center gap-1 px-3"
                            onClick={() => handleAcceptInvite(invite)}
                            disabled={actionInProgress}
                          >
                            <Check size={14} /> Accept
                          </Button>
                          <Button 
                            variant="outline-danger" 
                            size="sm"
                            className="d-flex align-items-center gap-1 px-3"
                            onClick={() => handleRejectInvite(invite)}
                            disabled={actionInProgress}
                          >
                            <X size={14} /> Reject
                          </Button>
                        </div>
                      </div>
                    </Col>
                  ))}
                </Row>
              )}
            </Card.Body>
          </Card>

          {/* Workspace Access List */}
          <Card className="border-0 shadow-sm" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle) !important', borderRadius: '12px' }}>
            <Card.Header className="bg-transparent border-0 pt-4 px-4 pb-2">
              <h5 className="fw-bold mb-0 d-flex align-items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Briefcase size={18} className="text-info" />
                Your Workspaces / Team Rooms
              </h5>
            </Card.Header>
            <Card.Body className="p-4">
              
              {/* Owned Workspaces */}
              <div className="mb-4">
                <h6 className="fw-bold text-muted mb-3" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>CREATED WORKSPACES (OWNER)</h6>
                {ownedWorkspaces.length === 0 ? (
                  <div className="text-muted text-center py-3 rounded-3 small" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-hover)' }}>
                    You haven't created any Team Rooms yet.
                  </div>
                ) : (
                  <div className="table-responsive rounded-3 overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    <Table hover variant={theme === 'dark' ? 'dark' : undefined} className="align-middle mb-0">
                      <thead>
                        <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                          <th className="border-0 text-muted small px-3 py-2">ROOM NAME</th>
                          <th className="border-0 text-muted small px-3 py-2">ROLE</th>
                          <th className="border-0 text-muted small px-3 py-2 text-end">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ownedWorkspaces.map(room => (
                          <tr key={room.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td className="px-3 py-3 fw-bold">
                              <span style={{ color: 'var(--accent)' }}>#</span> {room.name}
                            </td>
                            <td className="px-3 py-3">
                              <Badge bg="danger" className="py-1 px-2 rounded-pill" style={{ fontSize: '10px' }}>Owner</Badge>
                            </td>
                            <td className="px-3 py-3 text-end">
                              <Button 
                                size="sm" 
                                variant="outline-secondary"
                                className="d-inline-flex align-items-center gap-1 rounded-pill me-2"
                                style={{ fontSize: '11px', color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}
                                onClick={() => handleOpenManageModal(room)}
                              >
                                <Settings size={10} /> Manage Room
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline-primary"
                                className="d-inline-flex align-items-center gap-1 rounded-pill"
                                style={{ fontSize: '11px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                                onClick={() => navigate(`/?room=${room.id}`)}
                              >
                                Enter Workspace <ExternalLink size={10} />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Joined Workspaces */}
              <div>
                <h6 className="fw-bold text-muted mb-3" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>JOINED TEAM WORKSPACES</h6>
                {joinedWorkspaces.length === 0 ? (
                  <div className="text-muted text-center py-3 rounded-3 small" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-hover)' }}>
                    You haven't joined any team rooms.
                  </div>
                ) : (
                  <div className="table-responsive rounded-3 overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    <Table hover variant={theme === 'dark' ? 'dark' : undefined} className="align-middle mb-0">
                      <thead>
                        <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                          <th className="border-0 text-muted small px-3 py-2">ROOM NAME</th>
                          <th className="border-0 text-muted small px-3 py-2">OWNER</th>
                          <th className="border-0 text-muted small px-3 py-2 text-end">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {joinedWorkspaces.map(room => (
                          <tr key={room.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td className="px-3 py-3 fw-bold">
                              <span style={{ color: 'var(--accent)' }}>#</span> {room.name}
                            </td>
                            <td className="px-3 py-3 text-muted small">
                              {room.createdBy}
                            </td>
                            <td className="px-3 py-3 text-end">
                              <Button 
                                size="sm" 
                                variant="outline-primary"
                                className="d-inline-flex align-items-center gap-1 rounded-pill"
                                style={{ fontSize: '11px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                                onClick={() => navigate(`/?room=${room.id}`)}
                              >
                                Enter Workspace <ExternalLink size={10} />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </div>

            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Manage Team Room Modal (Only for Owner) */}
      <Modal 
        show={showManageModal} 
        onHide={() => { setShowManageModal(false); setSelectedRoom(null); }} 
        centered 
        size="lg"
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="border-secondary">
          <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
            <Settings size={20} className="me-2 text-warning" /> Manage Room: #{selectedRoom?.name}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4">
          <div className="mb-4">
            <h6 className="fw-bold text-muted mb-3" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>ROOM INFORMATION</h6>
            <div className="p-3 rounded-3" style={{ backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
              <div className="d-flex justify-content-between mb-2">
                <span className="text-muted small">Room ID/Workspace URL:</span>
                <span className="fw-bold theme-text-primary small">#{selectedRoom?.id}</span>
              </div>
              <div className="d-flex justify-content-between">
                <span className="text-muted small">Created By:</span>
                <span className="fw-bold theme-text-primary small">{selectedRoom?.createdBy || 'Owner'}</span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold text-muted mb-0" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>ROOM MEMBERS ({roomMembers.length})</h6>
            </div>
            
            {loadingMembers ? (
              <div className="text-center py-3">
                <Spinner size="sm" animation="border" className="text-info" />
              </div>
            ) : roomMembers.length === 0 ? (
              <div className="text-center py-3 text-muted small">No other members in this room yet.</div>
            ) : (
              <div className="table-responsive rounded-3 overflow-hidden" style={{ border: '1px solid var(--border-subtle)', maxHeight: '240px' }}>
                <Table hover variant={theme === 'dark' ? 'dark' : undefined} className="align-middle mb-0">
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <th className="border-0 text-muted small px-3 py-2">NAME / EMAIL</th>
                      <th className="border-0 text-muted small px-3 py-2">ROLE</th>
                      <th className="border-0 text-muted small px-3 py-2 text-end">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomMembers.map(member => (
                      <tr key={member.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td className="px-3 py-2">
                          <div className="fw-bold small theme-text-primary">{member.userName || member.userEmail.split('@')[0]}</div>
                          <div className="text-muted" style={{ fontSize: '10px' }}>{member.userEmail}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge 
                            bg={member.role === 'owner' ? 'danger' : 'info'} 
                            className="py-1 px-2 rounded-pill" 
                            style={{ fontSize: '9px' }}
                          >
                            {member.role}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-end">
                          {member.role !== 'owner' && member.userId !== currentUser.uid ? (
                            <Button 
                              size="sm" 
                              variant="outline-danger" 
                              className="py-1 px-2 rounded-pill d-inline-flex align-items-center gap-1"
                              style={{ fontSize: '10px' }}
                              onClick={() => handleRemoveMember(member)}
                            >
                              <UserMinus size={10} /> Remove
                            </Button>
                          ) : (
                            <span className="text-muted small px-2">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>

          <div className="border-top border-secondary pt-4 mt-4">
            <h6 className="fw-bold text-danger mb-2" style={{ fontSize: '12px', letterSpacing: '0.5px' }}>DANGER ZONE</h6>
            <div className="d-flex align-items-center justify-content-between p-3 rounded-3" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <div>
                <div className="fw-bold text-danger small">Delete Room Permanently</div>
                <div className="text-muted" style={{ fontSize: '11px' }}>All settings, file synchronization state, and user permissions will be wiped.</div>
              </div>
              <Button 
                variant="danger" 
                size="sm" 
                className="rounded-pill d-inline-flex align-items-center gap-1"
                style={{ fontSize: '11px' }}
                onClick={handleDeleteRoom}
              >
                <Trash2 size={12} /> Delete Room
              </Button>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </Container>
    </>
  );
}
