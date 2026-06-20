import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../firebase';
import GitHubService from '../../services/githubService';
import RepositorySelectorModal from './RepositorySelectorModal';
import { 
  doc, 
  onSnapshot, 
  updateDoc, 
  addDoc, 
  getDoc,
  setDoc,
  deleteDoc,
  collection, 
  query, 
  where, 
  serverTimestamp 
} from 'firebase/firestore';
import { Button, Form, Card, Badge, Spinner, Modal, InputGroup, Nav } from 'react-bootstrap';
import { 
  GitBranch, 
  GitCommit, 
  Settings, 
  Plus, 
  Upload, 
  Download, 
  Globe, 
  Terminal, 
  AlertCircle,
  Users,
  ShieldAlert,
  Lock
} from 'lucide-react';

export default function GitPanel({ editorRef, roomId }) {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  
  // Connections, Roles, and Git Status
  const [connection, setConnection] = useState(null);
  const [loadingConn, setLoadingConn] = useState(true);
  const [githubConn, setGithubConn] = useState(null);
  const [gitStatus, setGitStatus] = useState(null);
  const [loadingGitStatus, setLoadingGitStatus] = useState(true);
  const [memberRole, setMemberRole] = useState('viewer'); // default to viewer for security

  // Form states
  const [remoteUrlInput, setRemoteUrlInput] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  
  // Tab states for Timeline logs
  const [activeLogTab, setActiveLogTab] = useState('git'); // 'git' | 'audit'

  // Loading states for actions
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);

  // Branches
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Modals
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSelectorModal, setShowSelectorModal] = useState(false);

  // Settings
  const [autoSync, setAutoSync] = useState(false);
  const [syncInterval, setSyncInterval] = useState(5);
  const [autoMessage, setAutoMessage] = useState('Auto-sync: update {file}');

  // Local file changes state
  const [hasChanges, setHasChanges] = useState(false);
  const [activeFileContent, setActiveFileContent] = useState('');

  // Activity logs
  const [gitActivities, setGitActivities] = useState([]);

  // Collaborative Workflows & Pull Requests
  const [membersList, setMembersList] = useState([]);
  const [showBranchAssignments, setShowBranchAssignments] = useState(false);
  const [pullRequests, setPullRequests] = useState([]);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [showPRModal, setShowPRModal] = useState(false);
  const [prTitle, setPRTitle] = useState('');
  const [prBody, setPRBody] = useState('');
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [prApprovals, setPRApprovals] = useState({});
  const [isMergingPR, setIsMergingPR] = useState({});
  
  const lastAssignedBranchRef = useRef(null);

  // Subscribe to user's GitHub connection
  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'GitHubConnections', currentUser.uid);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        setGithubConn(snapshot.data());
      } else {
        setGithubConn(null);
      }
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Subscribe to Repository Connection for this room
  useEffect(() => {
    if (!roomId) return;
    const ref = doc(db, 'RepositoryConnections', roomId);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setConnection(data);
        setAutoSync(data.autoSyncEnabled || false);
        setSyncInterval(data.syncInterval || 5);
        setAutoMessage(data.autoCommitMessage || 'Auto-sync: update {file}');
      } else {
        setConnection(null);
      }
      setLoadingConn(false);
    }, (err) => {
      console.error("Error loading repo connection:", err);
      setLoadingConn(false);
    });
    return () => unsubscribe();
  }, [roomId]);

  // Subscribe to user's role in the room reactively
  useEffect(() => {
    if (!currentUser || !roomId) return;
    if (roomId === 'global') {
      setMemberRole('editor');
      return;
    }

    const roomRef = doc(db, 'Rooms', roomId);
    const unsubRoom = onSnapshot(roomRef, (roomSnap) => {
      if (roomSnap.exists() && roomSnap.data().ownerId === currentUser.uid) {
        setMemberRole('owner');
        return;
      }

      const memberRef = doc(db, 'WorkspaceMembers', `${roomId}_${currentUser.uid}`);
      const unsubMember = onSnapshot(memberRef, (memberSnap) => {
        if (memberSnap.exists()) {
          setMemberRole(memberSnap.data().role || 'editor');
        } else {
          setMemberRole('viewer');
        }
      });
      return () => unsubMember();
    });
    return () => unsubRoom();
  }, [roomId, currentUser]);

  // Check Git Status from server disk
  async function checkGitStatus() {
    if (!currentUser || !roomId) return;
    try {
      const status = await GitHubService.gitStatus(currentUser.uid, roomId);
      setGitStatus(status);
    } catch (e) {
      console.error("Error fetching local Git status:", e);
    } finally {
      setLoadingGitStatus(false);
    }
  }

  // Poll Git status on mount or when room / connection changes
  useEffect(() => {
    checkGitStatus();
  }, [roomId, connection]);

  // Fetch branches (reads local branch list if repo exists)
  async function fetchBranches() {
    if (!currentUser || !gitStatus?.initialized) return;
    setLoadingBranches(true);
    try {
      const owner = gitStatus.repoOwner || connection?.repoOwner || '';
      const repo = gitStatus.repoName || connection?.repoName || '';
      const list = await GitHubService.fetchBranches(
        currentUser.uid,
        githubConn?.accessToken,
        owner,
        repo,
        roomId
      );
      setBranches(list);
    } catch (e) {
      console.error("Error fetching branches:", e);
    } finally {
      setLoadingBranches(false);
    }
  }

  useEffect(() => {
    if (gitStatus?.initialized) {
      fetchBranches();
    } else {
      setBranches([]);
    }
  }, [gitStatus, githubConn]);

  // Subscribe to Git Activities in this room
  useEffect(() => {
    if (!roomId) return;
    const q = query(collection(db, 'GitActivity'), where('workspaceId', '==', roomId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate() : (a.createdAt ? new Date(a.createdAt) : 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : 0);
        return tB - tA;
      });
      setGitActivities(list);
    });
    return () => unsubscribe();
  }, [roomId]);

  // Subscribe to all Workspace Members in this room
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

  // Subscribe to PR approvals in Firestore
  useEffect(() => {
    if (!roomId) return;
    const q = query(collection(db, 'PullRequestApprovals'), where('workspaceId', '==', roomId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const approvals = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        approvals[data.prNumber] = data;
      });
      setPRApprovals(approvals);
    });
    return () => unsubscribe();
  }, [roomId]);

  // Conflict Prevention - Git Operation Lock Helpers
  const activeOp = connection?.activeOperation;
  const isGitLocked = !!activeOp;
  const isLockedByOther = isGitLocked && activeOp.userId !== currentUser.uid;

  // Auto-checkout assigned branch
  useEffect(() => {
    if (!currentUser || !gitStatus?.initialized || isSwitching || isGitLocked) return;
    
    const selfMember = membersList.find(m => m.userId === currentUser.uid);
    if (!selfMember || !selfMember.assignedBranch) return;

    const assigned = selfMember.assignedBranch;
    const current = gitStatus.currentBranch || connection?.branchName;

    if (assigned !== current && lastAssignedBranchRef.current !== assigned) {
      lastAssignedBranchRef.current = assigned;
      console.log(`[GitPanel] Auto-checkout assigned branch: ${assigned}`);
      handleSwitchBranch(assigned);
    }
  }, [membersList, gitStatus, isSwitching, isGitLocked]);

  // Fetch PRs function
  async function fetchPullRequests() {
    if (!currentUser || !gitStatus?.initialized || !gitStatus.hasRemote) return;
    setLoadingPRs(true);
    try {
      const owner = gitStatus.repoOwner || connection?.repoOwner || '';
      const repo = gitStatus.repoName || connection?.repoName || '';
      const prs = await GitHubService.fetchPullRequests(
        currentUser.uid,
        githubConn?.accessToken,
        owner,
        repo,
        'open'
      );
      setPullRequests(prs || []);
    } catch (err) {
      console.error("Error fetching PRs:", err);
    } finally {
      setLoadingPRs(false);
    }
  }

  // Fetch PRs when tab changes or connection changes
  useEffect(() => {
    if (activeLogTab === 'prs') {
      fetchPullRequests();
    }
  }, [activeLogTab, gitStatus]);

  // Check Monaco editor for changes
  useEffect(() => {
    const timer = setInterval(() => {
      if (editorRef.current && (gitStatus?.initialized || connection)) {
        const currentVal = editorRef.current.getValue();
        setActiveFileContent(currentVal);
        setHasChanges(currentVal !== (connection?.originalContent || ''));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [connection, gitStatus, editorRef]);

  async function acquireLock(opType) {
    if (!roomId) return false;
    try {
      const ref = doc(db, 'RepositoryConnections', roomId);
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data().activeOperation) {
        alert("Operation locked: Another Git command is currently running in the workspace.");
        return false;
      }
      await updateDoc(ref, {
        activeOperation: {
          type: opType,
          userId: currentUser.uid,
          userName: currentUser.displayName || currentUser.email.split('@')[0],
          timestamp: new Date().toISOString()
        }
      });
      return true;
    } catch (err) {
      console.error("Lock acquisition failed:", err);
      return false;
    }
  }

  async function releaseLock() {
    if (!roomId) return;
    try {
      const ref = doc(db, 'RepositoryConnections', roomId);
      await updateDoc(ref, {
        activeOperation: null
      });
    } catch (err) {
      console.error("Lock release failed:", err);
    }
  }

  // Permission Computations
  const isOwner = memberRole === 'owner';
  const canManageBranches = memberRole === 'owner' || memberRole === 'lead_developer' || memberRole === 'lead-developer' || memberRole === 'developer' || memberRole === 'editor' || memberRole === 'member';
  const canEdit = memberRole === 'owner' || memberRole === 'lead_developer' || memberRole === 'lead-developer' || memberRole === 'developer' || memberRole === 'editor' || memberRole === 'member';
  const isViewer = memberRole === 'viewer';

  // Assign branch to member
  async function handleAssignBranch(memberId, branchName) {
    if (!isOwner && memberId !== `${roomId}_${currentUser.uid}`) {
      alert("Only the room owner can assign branches to other members.");
      return;
    }
    try {
      const ref = doc(db, 'WorkspaceMembers', memberId);
      await updateDoc(ref, {
        assignedBranch: branchName
      });
      
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: gitStatus?.repoName || connection?.repoName || 'workspace',
        commitMessage: `Assigned branch ${branchName || 'Unassigned'} to ${memberId.split('_')[1] === currentUser.uid ? 'themselves' : 'member'}`,
        actionType: 'role-update',
        branchName: gitStatus?.currentBranch || connection?.branchName || 'main',
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error assigning branch:", err);
      alert("Failed to assign branch: " + err.message);
    }
  }

  // Create Pull Request
  async function handleCreatePullRequest(e) {
    e.preventDefault();
    if (!currentUser || !gitStatus?.initialized || isCreatingPR) return;
    
    const owner = gitStatus.repoOwner || connection?.repoOwner || '';
    const repo = gitStatus.repoName || connection?.repoName || '';
    const currentBranch = gitStatus.currentBranch || connection?.branchName || 'main';
    
    if (currentBranch === 'main' || currentBranch === 'master') {
      alert("Cannot create a pull request from the target branch. Switch to your feature branch first.");
      return;
    }

    setIsCreatingPR(true);
    try {
      const prData = {
        title: prTitle.trim(),
        body: prBody.trim(),
        head: currentBranch,
        base: 'main'
      };

      const pr = await GitHubService.createPullRequest(
        currentUser.uid,
        githubConn?.accessToken,
        owner,
        repo,
        prData
      );

      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repo,
        commitMessage: `Created Pull Request #${pr.number}: ${pr.title} (${currentBranch} → main)`,
        actionType: 'pr-create',
        branchName: currentBranch,
        createdAt: serverTimestamp()
      });

      alert(`Pull Request #${pr.number} created successfully!`);
      setPRTitle('');
      setPRBody('');
      setShowPRModal(false);
      fetchPullRequests();
    } catch (err) {
      console.error("Error creating PR:", err);
      alert("Failed to create Pull Request: " + err.message);
    } finally {
      setIsCreatingPR(false);
    }
  }

  // Approve PR
  async function handleApprovePR(prNumber, prTitleText) {
    if (!isOwner) {
      alert("Only the room owner can approve Pull Requests.");
      return;
    }

    try {
      const docId = `${roomId}_${prNumber}`;
      await setDoc(doc(db, 'PullRequestApprovals', docId), {
        workspaceId: roomId,
        prNumber: prNumber,
        approved: true,
        approvedBy: currentUser.uid,
        approverName: currentUser.displayName || currentUser.email.split('@')[0],
        approvedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: gitStatus?.repoName || connection?.repoName || 'workspace',
        commitMessage: `Approved Pull Request #${prNumber}: ${prTitleText}`,
        actionType: 'pr-approve',
        branchName: gitStatus?.currentBranch || connection?.branchName || 'main',
        createdAt: serverTimestamp()
      });

      alert(`Pull Request #${prNumber} approved!`);
    } catch (err) {
      console.error("Error approving PR:", err);
      alert("Failed to approve Pull Request: " + err.message);
    }
  }

  // Merge PR
  async function handleMergePR(prNumber, prTitleText, headBranch) {
    if (!isOwner) {
      alert("Only the room owner can merge Pull Requests.");
      return;
    }

    const approval = prApprovals[prNumber];
    if (!approval || !approval.approved) {
      alert("This Pull Request must be approved by the owner before merging.");
      return;
    }

    setIsMergingPR(prev => ({ ...prev, [prNumber]: true }));

    try {
      const owner = gitStatus.repoOwner || connection?.repoOwner || '';
      const repo = gitStatus.repoName || connection?.repoName || '';

      await GitHubService.mergePullRequest(
        currentUser.uid,
        githubConn?.accessToken,
        owner,
        repo,
        prNumber,
        `Merge pull request #${prNumber} from ${headBranch}`,
        `Merged by ${currentUser.displayName || currentUser.email.split('@')[0]} in Technify IDE`
      );

      await deleteDoc(doc(db, 'PullRequestApprovals', `${roomId}_${prNumber}`));

      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repo,
        commitMessage: `Merged Pull Request #${prNumber}: ${prTitleText} (${headBranch} → main)`,
        actionType: 'pr-merge',
        branchName: 'main',
        createdAt: serverTimestamp()
      });

      try {
        await GitHubService.deleteBranch(
          currentUser.uid,
          githubConn?.accessToken,
          owner,
          repo,
          headBranch
        );
        if (gitStatus.currentBranch === headBranch) {
          handleSwitchBranch('main');
        }
      } catch (delErr) {
        console.log("Branch deletion after merge skipped/failed:", delErr.message);
      }

      alert(`Pull Request #${prNumber} merged successfully!`);
      fetchPullRequests();
    } catch (err) {
      console.error("Error merging PR:", err);
      alert("Failed to merge Pull Request: " + err.message);
    } finally {
      setIsMergingPR(prev => ({ ...prev, [prNumber]: false }));
    }
  }

  function getActionBadgeProps(actionType) {
    switch (actionType) {
      case 'commit':
        return { bg: 'warning', text: 'Commit', color: '#f59e0b' };
      case 'push':
        return { bg: 'success', text: 'Push', color: '#10b981' };
      case 'pull':
        return { bg: 'info', text: 'Pull', color: '#3b82f6' };
      case 'switch':
      case 'create-branch':
        return { bg: 'purple', text: 'Branch', color: '#8b5cf6' };
      case 'pr-create':
      case 'pr-approve':
      case 'pr-merge':
        return { bg: 'danger', text: 'PR', color: '#ec4899' };
      default:
        return { bg: 'secondary', text: actionType?.toUpperCase() || 'Action', color: '#6b7280' };
    }
  }

  // Git Init
  async function handleGitInit() {
    if (!isOwner) return;
    
    setIsLoading(true);
    try {
      await GitHubService.gitInit(currentUser.uid, roomId);

      // Create a default repository connection in Firestore
      const ref = doc(db, 'RepositoryConnections', roomId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          workspaceId: roomId,
          userId: currentUser.uid,
          repoName: 'local-workspace',
          repoOwner: 'local',
          repoUrl: '',
          branchName: 'main',
          activeFilePath: 'index.js',
          originalContent: '// Start writing your code here...\nconsole.log("Hello, Technify Collab!");',
          syncedAt: serverTimestamp(),
          autoSyncEnabled: false,
          syncInterval: 5,
          autoCommitMessage: 'Auto-sync: updates in {file}'
        });
      }

      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: 'local-workspace',
        commitMessage: 'Initialized local Git repository',
        actionType: 'init',
        branchName: 'main',
        createdAt: serverTimestamp()
      });

      await checkGitStatus();
      alert("Git repository initialized locally on the server!");
    } catch (e) {
      console.error(e);
      alert("Init Failed: " + e.message);
    } finally {
      setIsLoading(false);
    }
  }

  // Git Remote Add
  async function handleRemoteAdd(e) {
    e.preventDefault();
    if (!isOwner || !remoteUrlInput.trim()) return;

    setIsLoading(true);
    try {
      await GitHubService.gitRemoteAdd(
        currentUser.uid,
        githubConn?.accessToken,
        roomId,
        remoteUrlInput.trim()
      );

      const cleanUrl = remoteUrlInput.trim();
      const match = cleanUrl.match(/(?:github\.com[:\/])([^\/]+)\/([^\/\.]+)(?:\.git)?$/);
      const repoOwner = match ? match[1] : 'origin';
      const repoName = match ? match[2] : 'repo';

      // Update Firestore connection to reference the new remote
      const ref = doc(db, 'RepositoryConnections', roomId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          repoName,
          repoOwner,
          repoUrl: cleanUrl,
          syncedAt: serverTimestamp()
        });
      } else {
        await setDoc(ref, {
          workspaceId: roomId,
          userId: currentUser.uid,
          repoName,
          repoOwner,
          repoUrl: cleanUrl,
          branchName: gitStatus?.currentBranch || 'main',
          activeFilePath: 'index.js',
          originalContent: activeFileContent || '// Start writing your code here...',
          syncedAt: serverTimestamp(),
          autoSyncEnabled: false,
          syncInterval: 5,
          autoCommitMessage: 'Auto-sync: updates in {file}'
        });
      }

      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName,
        commitMessage: `Connected remote origin repository: ${repoOwner}/${repoName}`,
        actionType: 'remote-add',
        branchName: gitStatus?.currentBranch || 'main',
        createdAt: serverTimestamp()
      });

      setRemoteUrlInput('');
      await checkGitStatus();
      alert("Remote origin connected successfully!");
    } catch (err) {
      console.error(err);
      alert("Remote Add Failed: " + err.message);
    } finally {
      setIsLoading(false);
    }
  }

  // Local Commit
  async function handleGitCommit() {
    if (!canEdit || isViewer) return;
    if (!commitMessage.trim()) {
      alert("Please enter a commit message!");
      return;
    }

    const hasLock = await acquireLock('commit');
    if (!hasLock) return;

    setIsCommitting(true);
    const content = editorRef.current ? editorRef.current.getValue() : activeFileContent;
    const filePath = connection?.activeFilePath || 'index.js';

    try {
      const owner = gitStatus?.repoOwner || connection?.repoOwner || 'local';
      const repo = gitStatus?.repoName || connection?.repoName || 'workspace';
      const branch = gitStatus?.currentBranch || connection?.branchName || 'main';

      await GitHubService.commitChanges(
        currentUser.uid,
        githubConn?.accessToken,
        owner,
        repo,
        branch,
        filePath,
        content,
        commitMessage,
        roomId
      );

      if (connection) {
        const ref = doc(db, 'RepositoryConnections', roomId);
        await updateDoc(ref, {
          originalContent: content,
          syncedAt: serverTimestamp()
        });
      }

      // Log activity
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repo,
        commitMessage: commitMessage,
        actionType: 'commit',
        branchName: branch,
        createdAt: serverTimestamp()
      });

      if (window.socket) {
        window.socket.emit('timeline-activity', {
          roomId,
          activity: {
            workspaceId: roomId,
            userId: currentUser.uid,
            username: currentUser.displayName || currentUser.email.split('@')[0],
            repoName: repo,
            commitMessage: commitMessage,
            actionType: 'commit',
            branchName: branch,
            createdAt: new Date().toISOString()
          }
        });
        window.socket.emit('send-notification', {
          roomId,
          notification: {
            message: `${currentUser.displayName || currentUser.email.split('@')[0]} committed changes to ${branch}: "${commitMessage}"`,
            type: 'git-commit',
            senderName: currentUser.displayName || currentUser.email.split('@')[0],
            timestamp: Date.now()
          }
        });
      }

      setCommitMessage('');
      setHasChanges(false);
      alert("Committed changes locally successfully!");
      await checkGitStatus();
    } catch (e) {
      console.error(e);
      alert("Commit Failed: " + e.message);
    } finally {
      setIsCommitting(false);
      await releaseLock();
    }
  }

  // Remote Push
  async function handleGitPush() {
    if (!canEdit || isViewer) return;
    const branch = gitStatus?.currentBranch || connection?.branchName || 'main';
    const repo = gitStatus?.repoName || connection?.repoName || 'workspace';

    if (branch === 'main' || branch === 'master') {
      alert(`Protected Branch: Direct push to '${branch}' is not allowed. Please commit to a feature branch and create a Pull Request instead.`);
      return;
    }

    const hasLock = await acquireLock('push');
    if (!hasLock) return;

    setIsPushing(true);
    try {
      await GitHubService.gitPush(
        currentUser.uid,
        githubConn?.accessToken,
        roomId,
        branch
      );

      // Log activity
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repo,
        commitMessage: `Pushed local commits to remote branch ${branch}`,
        actionType: 'push',
        branchName: branch,
        createdAt: serverTimestamp()
      });

      if (window.socket) {
        window.socket.emit('timeline-activity', {
          roomId,
          activity: {
            workspaceId: roomId,
            userId: currentUser.uid,
            username: currentUser.displayName || currentUser.email.split('@')[0],
            repoName: repo,
            commitMessage: `Pushed local commits to remote branch ${branch}`,
            actionType: 'push',
            branchName: branch,
            createdAt: new Date().toISOString()
          }
        });
        window.socket.emit('send-notification', {
          roomId,
          notification: {
            message: `${currentUser.displayName || currentUser.email.split('@')[0]} pushed changes to remote branch ${branch}`,
            type: 'git-push',
            senderName: currentUser.displayName || currentUser.email.split('@')[0],
            timestamp: Date.now()
          }
        });
      }

      alert(`Pushed to GitHub branch '${branch}' successfully!`);
      await checkGitStatus();
    } catch (e) {
      console.error(e);
      alert("Push Failed: " + e.message);
    } finally {
      setIsPushing(false);
      await releaseLock();
    }
  }

  // Remote Pull
  async function handleGitPull() {
    if (!canManageBranches || isViewer) return;
    const branch = gitStatus?.currentBranch || connection?.branchName || 'main';
    const repo = gitStatus?.repoName || connection?.repoName || 'workspace';
    const filePath = connection?.activeFilePath || 'index.js';

    const hasLock = await acquireLock('pull');
    if (!hasLock) return;

    setIsPulling(true);
    try {
      const res = await GitHubService.gitPull(
        currentUser.uid,
        githubConn?.accessToken,
        roomId,
        branch,
        filePath
      );

      // Update originalContent in RepositoryConnections (monaco will listen and update Yjs)
      if (connection) {
        const ref = doc(db, 'RepositoryConnections', roomId);
        await updateDoc(ref, {
          originalContent: res.content || '',
          syncedAt: serverTimestamp()
        });
      }

      // Log activity
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repo,
        commitMessage: `Pulled updates from remote branch ${branch}`,
        actionType: 'pull',
        branchName: branch,
        createdAt: serverTimestamp()
      });

      if (window.socket) {
        window.socket.emit('timeline-activity', {
          roomId,
          activity: {
            workspaceId: roomId,
            userId: currentUser.uid,
            username: currentUser.displayName || currentUser.email.split('@')[0],
            repoName: repo,
            commitMessage: `Pulled updates from remote branch ${branch}`,
            actionType: 'pull',
            branchName: branch,
            createdAt: new Date().toISOString()
          }
        });
        window.socket.emit('send-notification', {
          roomId,
          notification: {
            message: `${currentUser.displayName || currentUser.email.split('@')[0]} pulled updates from remote branch ${branch}`,
            type: 'git-pull',
            senderName: currentUser.displayName || currentUser.email.split('@')[0],
            timestamp: Date.now()
          }
        });
      }

      alert(`Pulled from remote branch '${branch}' successfully!`);
      await checkGitStatus();
    } catch (e) {
      console.error(e);
      alert("Pull Failed: " + e.message);
    } finally {
      setIsPulling(false);
      await releaseLock();
    }
  }

  // Switch Local Branch
  async function handleSwitchBranch(branchName) {
    if (!canManageBranches || isViewer || isSwitching) return;
    const filePath = connection?.activeFilePath || 'index.js';
    const repo = gitStatus?.repoName || connection?.repoName || 'workspace';

    const hasLock = await acquireLock('switch-branch');
    if (!hasLock) return;

    setIsSwitching(true);
    try {
      const res = await GitHubService.switchLocalBranch(
        currentUser.uid,
        githubConn?.accessToken,
        roomId,
        branchName,
        filePath
      );

      // Update Firestore repo connection
      const ref = doc(db, 'RepositoryConnections', roomId);
      await updateDoc(ref, {
        branchName: branchName,
        originalContent: res.content || '',
        syncedAt: serverTimestamp()
      });

      // Log activity
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repo,
        commitMessage: `Switched branch to ${branchName}`,
        actionType: 'switch',
        branchName: branchName,
        createdAt: serverTimestamp()
      });

      if (window.socket) {
        window.socket.emit('timeline-activity', {
          roomId,
          activity: {
            workspaceId: roomId,
            userId: currentUser.uid,
            username: currentUser.displayName || currentUser.email.split('@')[0],
            repoName: repo,
            commitMessage: `Switched branch to ${branchName}`,
            actionType: 'switch',
            branchName: branchName,
            createdAt: new Date().toISOString()
          }
        });
        window.socket.emit('send-notification', {
          roomId,
          notification: {
            message: `${currentUser.displayName || currentUser.email.split('@')[0]} switched branch to ${branchName}`,
            type: 'git-switch',
            senderName: currentUser.displayName || currentUser.email.split('@')[0],
            timestamp: Date.now()
          }
        });
      }

      await checkGitStatus();
    } catch (e) {
      console.error(e);
      alert("Branch Switch Failed: " + e.message);
    } finally {
      setIsSwitching(false);
      await releaseLock();
    }
  }

  // Create Local Branch
  async function handleCreateBranch(e) {
    e.preventDefault();
    const cleanBranch = newBranchName.trim().toLowerCase().replace(/[^a-zA-Z0-9_\-\/]/g, '');
    if (!canManageBranches || isViewer || !cleanBranch || isCreatingBranch) return;

    const hasLock = await acquireLock('create-branch');
    if (!hasLock) return;

    setIsCreatingBranch(true);
    try {
      const owner = gitStatus?.repoOwner || connection?.repoOwner || '';
      const repo = gitStatus?.repoName || connection?.repoName || '';
      const currentBranch = gitStatus?.currentBranch || connection?.branchName || 'main';

      await GitHubService.createBranch(
        currentUser.uid,
        githubConn?.accessToken,
        owner,
        repo,
        cleanBranch,
        currentBranch,
        roomId
      );

      // Switch to the newly created branch
      await releaseLock(); // release branch creation lock before checkout
      await handleSwitchBranch(cleanBranch);
      
      setShowBranchModal(false);
      setNewBranchName('');
    } catch (err) {
      console.error("Error creating branch:", err);
      alert("Branch Creation Failed: " + err.message);
      await releaseLock();
    } finally {
      setIsCreatingBranch(false);
    }
  }

  // Auto-Sync loop (Owner and Editor only)
  useEffect(() => {
    if (!connection || !connection.autoSyncEnabled || isPushing || isCommitting || isViewer) return;

    const intervalMs = (connection.syncInterval || 5) * 60 * 1000;
    const autoSyncTimer = setInterval(() => {
      if (editorRef.current && connection) {
        const currentVal = editorRef.current.getValue();
        if (currentVal !== connection.originalContent) {
          console.log("[Auto-Sync] Changes detected! Triggering auto-commit.");
          const filename = connection.activeFilePath.split('/').pop() || 'file';
          const msg = (connection.autoCommitMessage || 'Auto-sync: update {file}').replace('{file}', filename);
          
          setCommitMessage(msg);
          handleGitCommit();
        }
      }
    }, intervalMs);

    return () => clearInterval(autoSyncTimer);
  }, [connection, isPushing, isCommitting, memberRole]);

  // Update settings in Firestore (Owner only)
  async function handleUpdateSettings(e) {
    e.preventDefault();
    if (!isOwner) return;
    try {
      const ref = doc(db, 'RepositoryConnections', roomId);
      await updateDoc(ref, {
        autoSyncEnabled: autoSync,
        syncInterval: parseInt(syncInterval),
        autoCommitMessage: autoMessage
      });
      setShowSettingsModal(false);
    } catch (e) {
      console.error("Error updating settings:", e);
    }
  }

  // Filter logs for Dual Timeline Display
  const gitTimelineEvents = gitActivities.filter(act => 
    ['commit', 'push', 'pull', 'clone', 'init', 'remote-add', 'switch', 'create-branch'].includes(act.actionType)
  );
  
  const workspaceAuditEvents = gitActivities.filter(act => 
    ['invite', 'join', 'role-update', 'remove-member'].includes(act.actionType)
  );

  // Loading Screen
  if (loadingConn || (loadingGitStatus && !gitStatus)) {
    return (
      <div className="d-flex align-items-center justify-content-center p-5 text-muted h-100">
        <Spinner animation="border" size="sm" className="me-2 text-info" />
        Loading Git workspace...
      </div>
    );
  }

  // Viewer badge / Lock Banner rendering helpers
  const renderViewerBadge = () => isViewer && (
    <div className="d-flex align-items-center gap-1 py-1 px-2 mb-3 rounded-3 bg-secondary bg-opacity-20 border border-secondary text-muted small" style={{ fontSize: '11px' }}>
      <Lock size={12} className="text-secondary" />
      <span>Workspace is <strong>Read-Only</strong> (Viewer)</span>
    </div>
  );

  const renderLockBanner = () => isLockedByOther && (
    <div className="alert alert-warning py-2 px-3 mb-3 small d-flex align-items-center gap-2 rounded-3 border-warning border-opacity-20 bg-warning bg-opacity-5 text-warning" style={{ fontSize: '11px' }}>
      <ShieldAlert size={14} className="flex-shrink-0 text-warning" />
      <div>
        <strong>Git Lock Active:</strong> {activeOp.userName} is performing a <strong>{activeOp.type}</strong>. Controls are locked.
      </div>
    </div>
  );

  // 1. Disconnected view (No Git repository initialized)
  if (!gitStatus || !gitStatus.initialized) {
    return (
      <div className="d-flex flex-column h-100 p-3 justify-content-center align-items-center text-center">
        <Terminal size={48} className="text-muted mb-3 opacity-30" />
        <h6 className="fw-bold theme-text-primary mb-2">No Git Repository Initialized</h6>
        {renderViewerBadge()}
        
        <p className="text-muted small mb-4" style={{ maxWidth: '240px' }}>
          {isOwner 
            ? "This workspace room does not have a local Git repository. Choose an option to get started:" 
            : "This workspace is not linked to a repository. Please ask the team owner to clone or initialize Git."}
        </p>

        {isOwner ? (
          <div className="d-flex flex-column gap-2 w-100 px-3">
            <Button 
              variant="outline-info" 
              size="sm" 
              className="w-100 py-2 rounded-3"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              onClick={() => setShowSelectorModal(true)}
              disabled={isLoading}
            >
              Clone/Import Repository
            </Button>

            <Button 
              variant="primary" 
              size="sm" 
              className="w-100 py-2 rounded-3 border-0"
              style={{ background: 'var(--primary-gradient)' }}
              onClick={handleGitInit}
              disabled={isLoading}
            >
              {isLoading ? (
                <Spinner animation="border" size="sm" style={{ width: '12px', height: '12px' }} />
              ) : (
                'Initialize Local Git'
              )}
            </Button>
          </div>
        ) : (
          <Badge bg={theme === 'dark' ? 'dark' : 'light'} className="border border-secondary text-muted rounded-pill py-2 px-3">
            Awaiting Owner Setup
          </Badge>
        )}

        <RepositorySelectorModal 
          show={showSelectorModal} 
          onHide={() => setShowSelectorModal(false)} 
          roomId={roomId} 
        />
      </div>
    );
  }

  // 2. Initialized, but No Remote view
  if (!gitStatus.hasRemote) {
    return (
      <div className="d-flex flex-column h-100 p-3 justify-content-between">
        <div>
          {/* Header */}
          <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom border-secondary">
            <h6 className="fw-bold theme-text-primary mb-0 d-flex align-items-center gap-2">
              <GitBranch size={16} className="text-warning" />
              <span>Source Control</span>
            </h6>
          </div>

          {renderViewerBadge()}
          {renderLockBanner()}

          <Card className="theme-bg-secondary border border-secondary mb-4 rounded-3 p-3">
            <div className="d-flex align-items-center gap-2 mb-2 text-warning small">
              <AlertCircle size={14} />
              <span className="fw-bold">No Remote connected</span>
            </div>
            <p className="text-muted mb-0" style={{ fontSize: '11.5px' }}>
              Local repository active on branch <strong className="theme-text-primary">{gitStatus.currentBranch}</strong>. 
              {isOwner 
                ? " Connect a remote repository to push or pull changes." 
                : " Please ask the team owner to connect a remote origin repository."}
            </p>
          </Card>

          {isOwner && (
            <Form onSubmit={handleRemoteAdd} className="mb-4">
              <Form.Group className="mb-3">
                <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>REMOTE ORIGIN URL</Form.Label>
                <InputGroup size="sm">
                  <Form.Control
                    type="text"
                    placeholder="https://github.com/owner/repo.git"
                    value={remoteUrlInput}
                    onChange={(e) => setRemoteUrlInput(e.target.value)}
                    className="small"
                    disabled={isLoading || isGitLocked}
                    required
                  />
                  <Button 
                    variant="primary" 
                    type="submit" 
                    disabled={isLoading || !remoteUrlInput.trim() || isGitLocked}
                    style={{ background: 'var(--primary-gradient)', border: 'none' }}
                  >
                    {isLoading ? <Spinner animation="border" size="sm" style={{ width: '12px', height: '12px' }} /> : 'Add'}
                  </Button>
                </InputGroup>
              </Form.Group>
            </Form>
          )}

          {/* Local commit panel */}
          {!isViewer && (
            <div className="mb-4">
              <div className="text-muted small mb-2" style={{ fontSize: '10px' }}>CHANGES</div>
              {!hasChanges ? (
                <div className="p-3 text-center rounded-3 theme-bg-secondary text-muted small" style={{ border: '1px dashed var(--border-subtle)' }}>
                  No file modifications detected.
                </div>
              ) : (
                <div className="d-flex align-items-center justify-content-between p-2 rounded-3 theme-bg-secondary border border-secondary mb-3">
                  <div className="d-flex align-items-center gap-2 text-truncate">
                    <span className="text-warning">📝</span>
                    <span className="theme-text-primary small text-truncate" style={{ fontSize: '12px' }}>
                      {connection?.activeFilePath || 'index.js'}
                    </span>
                  </div>
                  <Badge bg="warning" text="dark" style={{ fontSize: '9px' }}>Modified</Badge>
                </div>
              )}

              <Form.Group className="mb-2">
                <Form.Control
                  as="textarea"
                  rows={2}
                  placeholder="Commit message..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="small"
                  style={{ fontSize: '12px' }}
                  disabled={!hasChanges || isCommitting || isGitLocked}
                />
              </Form.Group>
              <Button
                variant="primary"
                className="w-100 py-2 rounded-3 fw-bold d-flex align-items-center justify-content-center gap-2 border-0"
                style={{ background: 'var(--primary-gradient)', fontSize: '12px' }}
                onClick={handleGitCommit}
                disabled={!hasChanges || isCommitting || !commitMessage.trim() || isGitLocked}
              >
                {isCommitting ? (
                  <><Spinner animation="border" size="sm" style={{ width: '12px', height: '12px' }} /> Committing...</>
                ) : (
                  <><GitCommit size={14} /> Commit Locally</>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Change repository link */}
        {isOwner && (
          <div className="text-center pt-3 border-top border-secondary">
            <Button 
              variant="link" 
              className="p-0 text-info text-decoration-none small"
              onClick={() => setShowSelectorModal(true)}
              disabled={isGitLocked}
            >
              Import repository from GitHub instead
            </Button>
          </div>
        )}

        <RepositorySelectorModal 
          show={showSelectorModal} 
          onHide={() => setShowSelectorModal(false)} 
          roomId={roomId} 
        />
      </div>
    );
  }

  // 3. Connected view (Initialized & Has Remote)
  return (
    <div className="d-flex flex-column h-100 p-3">
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom border-secondary">
        <h6 className="fw-bold theme-text-primary mb-0 d-flex align-items-center gap-2">
          <GitBranch size={16} className="text-warning" />
          <span>Source Control</span>
        </h6>
        {isOwner && (
          <Button 
            variant="link" 
            className="p-1 text-muted d-flex align-items-center"
            onClick={() => setShowSettingsModal(true)}
          >
            <Settings size={14} />
          </Button>
        )}
      </div>

      {renderViewerBadge()}
      {renderLockBanner()}

      {/* Connected repository details */}
      <div className="mb-3 d-flex justify-content-between align-items-start">
        <div className="text-truncate">
          <div className="text-muted small" style={{ fontSize: '10px' }}>REMOTE REPOSITORY</div>
          <div className="fw-bold theme-text-primary small text-truncate" style={{ fontSize: '12.5px' }}>
            {gitStatus.repoOwner}/{gitStatus.repoName}
          </div>
        </div>
        {isOwner && (
          <Button 
            variant="link" 
            className="p-0 text-info text-decoration-none" 
            style={{ fontSize: '11px', outline: 'none', boxShadow: 'none' }}
            onClick={() => setShowSelectorModal(true)}
            disabled={isGitLocked}
          >
            Change
          </Button>
        )}
      </div>

      {/* Branch Selector */}
      <div className="mb-4">
        <div className="text-muted small mb-2" style={{ fontSize: '10px' }}>CURRENT BRANCH</div>
        <div className="d-flex gap-2">
          <Form.Select 
            size="sm" 
            value={gitStatus.currentBranch || 'main'} 
            onChange={(e) => handleSwitchBranch(e.target.value)}
            className="flex-grow-1"
            style={{ fontSize: '12px' }}
            disabled={loadingBranches || isSwitching || isGitLocked || !canManageBranches}
          >
            {loadingBranches ? (
              <option>Loading branches...</option>
            ) : branches.length === 0 ? (
              <option>{gitStatus.currentBranch || 'main'}</option>
            ) : (
              branches.map(b => (
                <option key={b.name} value={b.name}>{b.name}</option>
              ))
            )}
          </Form.Select>
          {canManageBranches && (
            <Button 
              variant="outline-secondary" 
              size="sm" 
              onClick={() => setShowBranchModal(true)}
              className="d-flex align-items-center justify-content-center"
              disabled={isGitLocked}
            >
              <Plus size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Branch Assignments */}
      <div className="mb-4">
        <div 
          className="text-muted small mb-2 d-flex align-items-center justify-content-between" 
          style={{ fontSize: '10px', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setShowBranchAssignments(!showBranchAssignments)}
        >
          <span className="d-flex align-items-center gap-1">
            <Users size={10} className="text-warning" /> BRANCH ASSIGNMENTS ({membersList.length})
          </span>
          <span style={{ fontSize: '8px' }}>{showBranchAssignments ? '▼' : '▶'}</span>
        </div>
        {showBranchAssignments && (
          <div className="d-flex flex-column gap-2 p-2.5 rounded-3 theme-bg-secondary border border-secondary">
            {membersList.length === 0 ? (
              <div className="text-muted text-center py-2 small" style={{ fontSize: '11px' }}>No members in workspace.</div>
            ) : (
              membersList.map(m => {
                const isSelf = m.userId === currentUser.uid;
                const memberId = `${roomId}_${m.userId}`;
                return (
                  <div key={m.id} className="d-flex align-items-center justify-content-between small py-1" style={{ fontSize: '11px' }}>
                    <div className="text-truncate me-2" style={{ maxWidth: '120px' }}>
                      <span className="fw-semibold theme-text-primary">{m.userName}</span> {isSelf && <span className="text-muted text-opacity-50">(you)</span>}
                    </div>
                    <div>
                      {isOwner || isSelf ? (
                        <Form.Select
                          size="sm"
                          value={m.assignedBranch || ''}
                          onChange={(e) => handleAssignBranch(memberId, e.target.value)}
                          className="small py-0 px-2"
                          style={{ fontSize: '10px', height: '22px', width: '130px' }}
                        >
                          <option value="">Unassigned</option>
                          {branches.map(b => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))}
                        </Form.Select>
                      ) : (
                        <Badge bg={theme === 'dark' ? 'dark' : 'light'} className="text-muted border border-secondary">
                          {m.assignedBranch || 'Unassigned'}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Sync actions: Pull & Push */}
      {!isViewer && (
        <div className="row g-2 mb-4">
          <div className="col-6">
            <Button
              variant="outline-secondary"
              size="sm"
              className="w-100 py-2 d-flex align-items-center justify-content-center gap-2 border-secondary text-light"
              style={{ fontSize: '12px' }}
              onClick={handleGitPull}
              disabled={isPulling || isSwitching || isPushing || isGitLocked}
            >
              {isPulling ? (
                <Spinner animation="border" size="sm" style={{ width: '12px', height: '12px' }} />
              ) : (
                <><Download size={14} className="text-info" /> Pull</>
              )}
            </Button>
          </div>
          <div className="col-6">
            <Button
              variant="outline-secondary"
              size="sm"
              className="w-100 py-2 d-flex align-items-center justify-content-center gap-2 border-secondary text-light"
              style={{ fontSize: '12px' }}
              onClick={handleGitPush}
              disabled={isPushing || isSwitching || isPulling || isGitLocked}
            >
              {isPushing ? (
                <Spinner animation="border" size="sm" style={{ width: '12px', height: '12px' }} />
              ) : (
                <><Upload size={14} className="text-success" /> Push</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* File Changes section */}
      {!isViewer && (
        <div className="mb-4">
          <div className="text-muted small mb-2 d-flex align-items-center justify-content-between" style={{ fontSize: '10px' }}>
            <span>CHANGES</span>
            {connection?.autoSyncEnabled && <Badge bg="success" style={{ fontSize: '8px' }}>Auto-Sync ON</Badge>}
          </div>
          {!hasChanges ? (
            <div className="p-3 text-center rounded-3 theme-bg-secondary text-muted small" style={{ border: '1px dashed var(--border-subtle)' }}>
              No file modifications detected.
            </div>
          ) : (
            <div className="d-flex align-items-center justify-content-between p-2 rounded-3 theme-bg-secondary border border-secondary">
              <div className="d-flex align-items-center gap-2 text-truncate">
                <span className="text-warning">📝</span>
                <span className="theme-text-primary small text-truncate" style={{ fontSize: '12px' }}>
                  {connection?.activeFilePath || 'index.js'}
                </span>
              </div>
              <Badge bg="warning" text="dark" style={{ fontSize: '9px' }}>Modified</Badge>
            </div>
          )}
        </div>
      )}

      {/* Commit input & Commit locally */}
      {!isViewer && (
        <div className="mb-4">
          <Form.Group className="mb-2">
            <Form.Control
              as="textarea"
              rows={2}
              placeholder="Commit message..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              className="small"
              style={{ fontSize: '12px' }}
              disabled={!hasChanges || isCommitting || isGitLocked}
            />
          </Form.Group>
          <Button
            variant="primary"
            className="w-100 py-2 rounded-3 fw-bold d-flex align-items-center justify-content-center gap-2 border-0"
            style={{ background: 'var(--primary-gradient)', fontSize: '12px' }}
            onClick={handleGitCommit}
            disabled={!hasChanges || isCommitting || !commitMessage.trim() || isGitLocked}
          >
            {isCommitting ? (
              <><Spinner animation="border" size="sm" style={{ width: '12px', height: '12px' }} /> Committing...</>
            ) : (
              <><GitCommit size={14} /> Commit Locally</>
            )}
          </Button>
        </div>
      )}

      {/* Log Tabs Area: Git Timeline, Pull Requests, vs Workspace Audit */}
      <div className="flex-grow-1 overflow-hidden border-top border-secondary pt-3 d-flex flex-column">
        <Nav variant="pills" activeKey={activeLogTab} onSelect={(k) => setActiveLogTab(k)} className="mb-2 bg-secondary bg-opacity-10 p-1 rounded-3" style={{ fontSize: '10px' }}>
          <Nav.Item className="text-center" style={{ flex: 1 }}>
            <Nav.Link eventKey="git" className="py-1 px-1 border-0" style={{ cursor: 'pointer' }}>Git Timeline</Nav.Link>
          </Nav.Item>
          <Nav.Item className="text-center" style={{ flex: 1 }}>
            <Nav.Link eventKey="prs" className="py-1 px-1 border-0" style={{ cursor: 'pointer' }}>PRs</Nav.Link>
          </Nav.Item>
          <Nav.Item className="text-center" style={{ flex: 1 }}>
            <Nav.Link eventKey="audit" className="py-1 px-1 border-0" style={{ cursor: 'pointer' }}>Audit</Nav.Link>
          </Nav.Item>
        </Nav>

        <div className="flex-grow-1 overflow-auto custom-scrollbar pr-1">
          {activeLogTab === 'git' ? (
            gitTimelineEvents.length === 0 ? (
              <div className="text-muted text-center py-4 small">No Git operations logged.</div>
            ) : (
              <div className="d-flex flex-column gap-2" style={{ maxHeight: '180px' }}>
                {gitTimelineEvents.map((act) => {
                  const badgeProps = getActionBadgeProps(act.actionType);
                  return (
                    <div 
                      key={act.id} 
                      className="p-2 rounded-3 border mb-1 position-relative timeline-item" 
                      style={{ 
                        backgroundColor: 'rgba(255,255,255,0.01)', 
                        borderColor: 'var(--border-subtle)', 
                        fontSize: '11px',
                        borderLeft: `3px solid ${badgeProps.color}` 
                      }}
                    >
                      <div className="d-flex justify-content-between align-items-center text-muted mb-1" style={{ fontSize: '9px' }}>
                        <div className="d-flex align-items-center gap-1">
                          <span 
                            className="rounded-circle d-flex align-items-center justify-content-center fw-bold text-white text-uppercase"
                            style={{ width: '16px', height: '16px', fontSize: '8px', backgroundColor: badgeProps.color }}
                          >
                            {act.username?.charAt(0)}
                          </span>
                          <span className="fw-semibold text-white">{act.username}</span>
                        </div>
                        <Badge 
                          style={{ 
                            fontSize: '8px', 
                            backgroundColor: `${badgeProps.color}22`, 
                            color: badgeProps.color, 
                            border: `1px solid ${badgeProps.color}44` 
                          }}
                        >
                          {badgeProps.text}
                        </Badge>
                      </div>
                      <div className="theme-text-primary" style={{ fontSize: '11px', wordBreak: 'break-word' }}>
                        {act.commitMessage}
                      </div>
                      <div className="d-flex justify-content-between align-items-center mt-1.5 text-muted" style={{ fontSize: '8.5px' }}>
                        <span>
                          {act.branchName && (
                            <span className="badge-branch theme-bg-secondary border border-secondary border-opacity-40 px-1 py-0.5 rounded text-warning">
                              🌿 {act.branchName}
                            </span>
                          )}
                        </span>
                        <span>
                          {act.createdAt ? new Date(act.createdAt.toDate ? act.createdAt.toDate() : act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : activeLogTab === 'prs' ? (
            <div className="d-flex flex-column h-100">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span className="text-muted small" style={{ fontSize: '10px', fontWeight: 'bold' }}>OPEN PULL REQUESTS</span>
                {!isViewer && gitStatus.hasRemote && (
                  <Button 
                    size="sm" 
                    variant="outline-info" 
                    onClick={() => {
                      setPRTitle('');
                      setPRBody('');
                      setShowPRModal(true);
                    }}
                    className="py-0 px-2"
                    style={{ fontSize: '10.5px', color: 'var(--accent)', borderColor: 'var(--accent)', height: '20px' }}
                  >
                    New PR
                  </Button>
                )}
              </div>
              
              <div className="d-flex flex-column gap-2" style={{ maxHeight: '180px' }}>
                {!gitStatus.hasRemote ? (
                  <div className="text-muted text-center py-4 small">Connect a remote to manage PRs.</div>
                ) : loadingPRs ? (
                  <div className="text-muted text-center py-4 small">
                    <Spinner animation="border" size="sm" className="me-2 text-info" style={{ width: '12px', height: '12px' }} />
                    Loading PRs...
                  </div>
                ) : pullRequests.length === 0 ? (
                  <div className="text-muted text-center py-4 small">No open Pull Requests found.</div>
                ) : (
                  pullRequests.map((pr) => {
                    const approval = prApprovals[pr.number];
                    const isApproved = approval && approval.approved;
                    const prHeadBranch = pr.head?.ref || '';
                    
                    return (
                      <div 
                        key={pr.number} 
                        className="p-2 rounded-3 border" 
                        style={{ 
                          backgroundColor: 'rgba(255,255,255,0.01)', 
                          borderColor: 'var(--border-subtle)', 
                          fontSize: '11px' 
                        }}
                      >
                        <div className="d-flex justify-content-between text-muted mb-1" style={{ fontSize: '9px' }}>
                          <span className="fw-semibold text-white">#{pr.number} by {pr.user?.login}</span>
                          {isApproved ? (
                            <Badge bg="success" className="border border-success border-opacity-40" style={{ fontSize: '8px' }}>APPROVED</Badge>
                          ) : (
                            <Badge bg="warning" text="dark" className="border border-warning border-opacity-40" style={{ fontSize: '8px' }}>AWAITING APPROVAL</Badge>
                          )}
                        </div>
                        <div className="text-light fw-bold" style={{ fontSize: '11.5px' }}>
                          {pr.title}
                        </div>
                        <div className="text-muted my-1" style={{ fontSize: '10px' }}>
                          <code className="text-info">{prHeadBranch}</code> → <code className="text-muted">{pr.base?.ref || 'main'}</code>
                        </div>
                        
                        <div className="d-flex gap-2 justify-content-end mt-2 pt-2 border-top border-secondary border-opacity-30">
                          {isOwner && !isApproved && (
                            <Button
                              size="sm"
                              variant="success"
                              className="py-0 px-2 fw-bold"
                              style={{ fontSize: '10px', height: '22px' }}
                              onClick={() => handleApprovePR(pr.number, pr.title)}
                            >
                              Approve
                            </Button>
                          )}
                          
                          {isOwner && (
                            <Button
                              size="sm"
                              variant="primary"
                              className="py-0 px-2 fw-bold"
                              style={{ 
                                fontSize: '10px', 
                                height: '22px', 
                                background: isApproved ? 'var(--primary-gradient)' : '#495057',
                                border: 'none' 
                              }}
                              disabled={!isApproved || isMergingPR[pr.number]}
                              onClick={() => handleMergePR(pr.number, pr.title, prHeadBranch)}
                            >
                              {isMergingPR[pr.number] ? 'Merging...' : 'Merge PR'}
                            </Button>
                          )}
                          
                          {!isOwner && (
                            <span className="text-muted small" style={{ fontSize: '9px' }}>
                              {isApproved ? 'Approved by Owner. Awaiting merge.' : 'Pending Owner review.'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            workspaceAuditEvents.length === 0 ? (
              <div className="text-muted text-center py-4 small">No workspace audit logs.</div>
            ) : (
              <div className="d-flex flex-column gap-2" style={{ maxHeight: '180px' }}>
                {workspaceAuditEvents.map((act) => (
                  <div 
                    key={act.id} 
                    className="p-2 rounded-3 border" 
                    style={{ 
                      backgroundColor: 'rgba(255,255,255,0.01)', 
                      borderColor: 'var(--border-subtle)', 
                      fontSize: '11px' 
                    }}
                  >
                    <div className="d-flex justify-content-between text-muted mb-1" style={{ fontSize: '9px' }}>
                      <span className="fw-semibold theme-text-primary">{act.username}</span>
                      <Badge bg={theme === 'dark' ? 'dark' : 'light'} className="text-warning border border-secondary border-opacity-40" style={{ fontSize: '8px' }}>{act.actionType?.toUpperCase()}</Badge>
                    </div>
                    <div className="theme-text-primary" style={{ fontSize: '11px', lineBreak: 'anywhere' }}>
                      {act.commitMessage}
                    </div>
                    <div className="text-end text-muted mt-1" style={{ fontSize: '8.5px' }}>
                      {act.createdAt ? new Date(act.createdAt.toDate ? act.createdAt.toDate() : act.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* New Branch Modal */}
      <Modal 
        show={showBranchModal} 
        onHide={() => setShowBranchModal(false)} 
        centered
        contentClassName="theme-modal text-light border-secondary"
      >
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="border-secondary">
          <Modal.Title style={{ fontSize: '15px' }} className="d-flex align-items-center gap-2">
            <GitBranch size={16} className="text-warning" /> Create Local Branch
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleCreateBranch}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>NEW BRANCH NAME</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. feature/api-sync"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value.toLowerCase().replace(/[^a-zA-Z0-9_\-\/]/g, ''))}
                className=""
                required
                autoFocus
              />
              <div className="d-flex gap-1.5 mt-2 flex-wrap">
                {['feature/', 'bugfix/', 'hotfix/', 'release/'].map(prefix => (
                  <Button
                    key={prefix}
                    variant="outline-secondary"
                    size="sm"
                    style={{ fontSize: '10px', padding: '2px 6px' }}
                    onClick={() => {
                      if (!newBranchName.startsWith(prefix)) {
                        setNewBranchName(prefix + newBranchName.replace(/^(feature\/|bugfix\/|hotfix\/|release\/)/, ''));
                      }
                    }}
                  >
                    {prefix}
                  </Button>
                ))}
              </div>
              <Form.Text className="text-muted small mt-2 d-block">
                Branch will be branched off from the current branch: <strong className="theme-text-primary">{gitStatus.currentBranch}</strong>
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="border-secondary">
            <Button variant="outline-secondary" size="sm" onClick={() => setShowBranchModal(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              type="submit" 
              disabled={isCreatingBranch || !newBranchName.trim()}
              style={{ background: 'var(--primary-gradient)', border: 'none' }}
            >
              {isCreatingBranch ? 'Creating...' : 'Create Branch'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Settings Modal */}
      <Modal 
        show={showSettingsModal} 
        onHide={() => setShowSettingsModal(false)} 
        centered
        contentClassName="theme-modal text-light border-secondary"
      >
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="border-secondary">
          <Modal.Title style={{ fontSize: '15px' }} className="d-flex align-items-center gap-2">
            <Settings size={16} className="text-muted" /> Git Sync Settings
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleUpdateSettings}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Check 
                type="switch"
                id="auto-sync-switch"
                label="Enable Auto-Commit Sync"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="theme-text-primary small fw-bold"
              />
              <Form.Text className="text-muted small">
                When enabled, the IDE will automatically commit and push any changes to GitHub periodically.
              </Form.Text>
            </Form.Group>
            
            {autoSync && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>SYNC INTERVAL (MINUTES)</Form.Label>
                  <Form.Select 
                    value={syncInterval} 
                    onChange={(e) => setSyncInterval(e.target.value)}
                    className=""
                  >
                    <option value="1">1 minute</option>
                    <option value="3">3 minutes</option>
                    <option value="5">5 minutes</option>
                    <option value="10">10 minutes</option>
                  </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AUTO COMMIT MESSAGE TEMPLATE</Form.Label>
                  <Form.Control
                    type="text"
                    value={autoMessage}
                    onChange={(e) => setAutoMessage(e.target.value)}
                    className=""
                    required
                  />
                  <Form.Text className="text-muted small">
                    Use `{'{file}'}` to dynamically inject the active file's basename.
                  </Form.Text>
                </Form.Group>
              </>
            )}
          </Modal.Body>
          <Modal.Footer className="border-secondary">
            <Button variant="outline-secondary" size="sm" onClick={() => setShowSettingsModal(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              type="submit" 
              style={{ background: 'var(--primary-gradient)', border: 'none' }}
            >
              Save Settings
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <RepositorySelectorModal 
        show={showSelectorModal} 
        onHide={() => setShowSelectorModal(false)} 
        roomId={roomId} 
      />

      {/* Create Pull Request Modal */}
      <Modal 
        show={showPRModal} 
        onHide={() => setShowPRModal(false)} 
        centered
        contentClassName="theme-modal text-light border-secondary"
      >
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="border-secondary">
          <Modal.Title style={{ fontSize: '15px' }} className="d-flex align-items-center gap-2">
            <GitBranch size={16} className="text-info" /> Create Pull Request
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleCreatePullRequest}>
          <Modal.Body>
            <div className="mb-3 p-2.5 rounded-3 theme-bg-secondary border border-secondary small text-muted">
              Source Branch: <strong className="theme-text-primary">{gitStatus?.currentBranch || connection?.branchName}</strong>
              <br />
              Target Branch: <strong className="theme-text-primary">main</strong> (Production)
            </div>
            
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PULL REQUEST TITLE</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. Implement navbar responsiveness"
                value={prTitle}
                onChange={(e) => setPRTitle(e.target.value)}
                className=""
                required
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PULL REQUEST DESCRIPTION</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder="Describe your changes..."
                value={prBody}
                onChange={(e) => setPRBody(e.target.value)}
                className=""
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="border-secondary">
            <Button variant="outline-secondary" size="sm" onClick={() => setShowPRModal(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              type="submit" 
              disabled={isCreatingPR || !prTitle.trim()}
              style={{ background: 'var(--primary-gradient)', border: 'none' }}
            >
              {isCreatingPR ? 'Creating PR...' : 'Create Pull Request'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
}
