/**
 * Projects Component
 * 
 * Team Projects Portal and Dashboard.
 * Supports:
 *   - Listing collaborative team projects.
 *   - Creating new team projects with stack selections and member role assignments.
 *   - Real-time Project Dashboard displaying member lists, roles, and connected repository.
 *   - Live active developer indicators using Socket.IO room presence.
 *   - Owner settings to add, remove, or change roles of developers.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db } from '../firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  orderBy,
  where,
  serverTimestamp 
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { 
  FolderPlus, FolderOpen, Users, GitBranch, Play, 
  Plus, Trash2, Edit3, Settings, Shield, UserCheck, 
  Cpu, Activity, Globe, ArrowLeft, Loader, RefreshCw
} from 'lucide-react';
import { Button, Form, Modal, Card, Table, Badge, InputGroup, OverlayTrigger, Tooltip } from 'react-bootstrap';

export default function Projects() {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();

  // Selected Project for Dashboard
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  
  // Data States
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [repoConnection, setRepoConnection] = useState(null);
  const [activeDevs, setActiveDevs] = useState([]);

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);

  // New Project Form
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [projectStack, setProjectStack] = useState('React');
  const [newProjectMembers, setNewProjectMembers] = useState([]); // Array of { userId, email, name, role }
  const [memberEmailInput, setMemberEmailInput] = useState('');
  const [memberRoleInput, setMemberRoleInput] = useState('developer');
  const [creatingProject, setCreatingProject] = useState(false);

  // Dashboard Manage Member Form
  const [addEmailInput, setAddEmailInput] = useState('');
  const [addRoleInput, setAddRoleInput] = useState('developer');
  const [addingMember, setAddingMember] = useState(false);

  // Fetch projects current user belongs to
  useEffect(() => {
    if (!currentUser) return;

    const q = query(collection(db, 'Projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const userProjects = list.filter(proj => 
        proj.ownerId === currentUser.uid || 
        (proj.teamMembers && proj.teamMembers.some(m => m.userId === currentUser.uid))
      );
      setProjects(userProjects);
      setLoading(false);

      // Keep active project details synced
      if (selectedProjectId) {
        const activeProj = userProjects.find(p => p.id === selectedProjectId);
        if (activeProj) {
          setSelectedProject(activeProj);
        }
      }
    }, (err) => {
      console.error("Error loading projects:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, selectedProjectId]);

  // Subscribe to Selected Project's Repository Connection
  useEffect(() => {
    if (!selectedProject) {
      setRepoConnection(null);
      return;
    }

    const ref = doc(db, 'RepositoryConnections', selectedProject.workspaceId);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        setRepoConnection(snapshot.data());
      } else {
        setRepoConnection(null);
      }
    }, (err) => {
      console.error("Error subscribing to RepositoryConnections:", err);
    });

    return () => unsubscribe();
  }, [selectedProject]);

  // Socket.IO presence tracking for Selected Project's Active Developers
  useEffect(() => {
    if (!selectedProject || !currentUser) {
      setActiveDevs([]);
      return;
    }

    const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    const socket = io(API_BASE, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    const name = currentUser.displayName || currentUser.email.split('@')[0];
    const joinRoomData = {
      roomId: selectedProject.workspaceId,
      uid: currentUser.uid,
      name,
      avatar: currentUser.photoURL || ''
    };

    socket.on('connect', () => {
      socket.emit('join-room', joinRoomData);
    });

    if (socket.connected) {
      socket.emit('join-room', joinRoomData);
    }

    socket.on('presence-update', (list) => {
      // Filter out any duplicates and self if preferred, but listing all online is best
      setActiveDevs(list);
    });

    return () => {
      socket.disconnect();
    };
  }, [selectedProject, currentUser]);

  // Handle Search and Add Member to temporary create list
  async function handleAddMemberToCreateList(e) {
    e.preventDefault();
    const emailClean = memberEmailInput.trim().toLowerCase();
    if (!emailClean) return;

    if (emailClean === currentUser.email.toLowerCase()) {
      alert("You are already the owner of this project!");
      return;
    }

    if (newProjectMembers.some(m => m.email === emailClean)) {
      alert("Developer is already in the list!");
      return;
    }

    try {
      const usersRef = collection(db, 'Users');
      const q = query(usersRef, where('email', '==', emailClean));
      const snap = await getDocs(q);

      if (snap.empty) {
        alert("Developer with this email was not found. They must sign up first!");
        return;
      }

      const userDoc = snap.docs[0];
      const userData = userDoc.data();

      setNewProjectMembers(prev => [
        ...prev,
        {
          userId: userData.uid,
          email: userData.email,
          name: userData.displayName || userData.email.split('@')[0],
          role: memberRoleInput
        }
      ]);
      setMemberEmailInput('');
    } catch (err) {
      console.error("Error searching developer:", err);
      alert("Search failed: " + err.message);
    }
  }

  // Remove member from temporary create list
  function handleRemoveFromCreateList(email) {
    setNewProjectMembers(prev => prev.filter(m => m.email !== email));
  }

  // Handle Create Project Submit
  async function handleCreateProjectSubmit(e) {
    e.preventDefault();
    if (!projectName.trim()) return;

    setCreatingProject(true);
    const workspaceId = 'wp_' + Math.random().toString(36).substring(2, 11);
    
    const ownerName = currentUser.displayName || currentUser.email.split('@')[0];
    const teamMembersList = [
      {
        userId: currentUser.uid,
        email: currentUser.email,
        name: ownerName,
        role: 'owner'
      },
      ...newProjectMembers
    ];

    try {
      // 1. Create Projects document
      const projectRef = doc(collection(db, 'Projects'));
      const projectId = projectRef.id;

      await setDoc(projectRef, {
        projectId,
        projectName: projectName.trim(),
        description: projectDesc.trim(),
        ownerId: currentUser.uid,
        teamMembers: teamMembersList,
        workspaceId,
        githubRepository: '',
        stack: projectStack,
        status: 'active',
        createdAt: serverTimestamp()
      });

      // 2. Create Rooms document for workspace initialization
      await setDoc(doc(db, 'Rooms', workspaceId), {
        id: workspaceId,
        name: projectName.trim(),
        ownerId: currentUser.uid,
        createdBy: ownerName,
        createdAt: serverTimestamp()
      });

      // 3. Create WorkspaceMembers documents for everyone
      for (const member of teamMembersList) {
        await setDoc(doc(db, 'WorkspaceMembers', `${workspaceId}_${member.userId}`), {
          workspaceId,
          userId: member.userId,
          userEmail: member.email,
          userName: member.name,
          role: member.role,
          joinedAt: serverTimestamp()
        });
      }

      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'CREATE_PROJECT',
        details: `Created team project "${projectName.trim()}"`,
        timestamp: serverTimestamp()
      });

      // Reset Form and Modal
      setProjectName('');
      setProjectDesc('');
      setProjectStack('React');
      setNewProjectMembers([]);
      setShowCreateModal(false);
      
      // Auto-open Project Dashboard
      setSelectedProjectId(projectId);
      setSelectedProject({
        id: projectId,
        projectName: projectName.trim(),
        description: projectDesc.trim(),
        ownerId: currentUser.uid,
        teamMembers: teamMembersList,
        workspaceId,
        stack: projectStack,
        status: 'active'
      });
    } catch (err) {
      console.error("Error creating project:", err);
      alert("Failed to create project: " + err.message);
    } finally {
      setCreatingProject(false);
    }
  }

  // Handle Add Member inside Selected Project Dashboard (Owner Only)
  async function handleAddDashboardMemberSubmit(e) {
    e.preventDefault();
    if (!selectedProject) return;
    const emailClean = addEmailInput.trim().toLowerCase();
    if (!emailClean) return;

    setAddingMember(true);
    try {
      // Search user
      const usersRef = collection(db, 'Users');
      const q = query(usersRef, where('email', '==', emailClean));
      const snap = await getDocs(q);

      if (snap.empty) {
        alert("Developer with this email was not found. They must sign up first!");
        setAddingMember(false);
        return;
      }

      const userDoc = snap.docs[0];
      const userData = userDoc.data();

      // Check if already in project members list
      if (selectedProject.teamMembers.some(m => m.userId === userData.uid)) {
        alert("This developer is already a member of this project!");
        setAddingMember(false);
        return;
      }

      // Update Project Members Array in Firestore
      const newMember = {
        userId: userData.uid,
        email: userData.email,
        name: userData.displayName || userData.email.split('@')[0],
        role: addRoleInput
      };
      
      const updatedMembers = [...selectedProject.teamMembers, newMember];
      const projectRef = doc(db, 'Projects', selectedProject.id);
      await updateDoc(projectRef, {
        teamMembers: updatedMembers
      });

      // Write to WorkspaceMembers collection
      const workspaceId = selectedProject.workspaceId;
      await setDoc(doc(db, 'WorkspaceMembers', `${workspaceId}_${userData.uid}`), {
        workspaceId,
        userId: userData.uid,
        userEmail: userData.email,
        userName: newMember.name,
        role: addRoleInput,
        joinedAt: serverTimestamp()
      });

      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'ADD_PROJECT_MEMBER',
        details: `Added user ${userData.email} to project "${selectedProject.projectName}"`,
        timestamp: serverTimestamp()
      });

      setAddEmailInput('');
      setShowAddMemberModal(false);
    } catch (err) {
      console.error("Error adding project member:", err);
      alert("Failed to add member: " + err.message);
    } finally {
      setAddingMember(false);
    }
  }

  // Handle Remove Member from Selected Project Dashboard (Owner Only)
  async function handleRemoveDashboardMember(userId, userEmail) {
    if (!selectedProject) return;
    if (userId === currentUser.uid) {
      alert("You cannot remove yourself!");
      return;
    }

    if (!window.confirm(`Are you sure you want to remove ${userEmail} from this project?`)) return;

    try {
      const updatedMembers = selectedProject.teamMembers.filter(m => m.userId !== userId);
      const projectRef = doc(db, 'Projects', selectedProject.id);
      await updateDoc(projectRef, {
        teamMembers: updatedMembers
      });

      // Delete WorkspaceMembers document
      const workspaceId = selectedProject.workspaceId;
      await deleteDoc(doc(db, 'WorkspaceMembers', `${workspaceId}_${userId}`));

      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'REMOVE_PROJECT_MEMBER',
        details: `Removed user ${userEmail} from project "${selectedProject.projectName}"`,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("Error removing member:", err);
      alert("Failed to remove member: " + err.message);
    }
  }

  // Handle Update Member Role in Selected Project (Owner Only)
  async function handleUpdateDashboardMemberRole(userId, newRole) {
    if (!selectedProject) return;
    try {
      const updatedMembers = selectedProject.teamMembers.map(m => {
        if (m.userId === userId) {
          return { ...m, role: newRole };
        }
        return m;
      });

      const projectRef = doc(db, 'Projects', selectedProject.id);
      await updateDoc(projectRef, {
        teamMembers: updatedMembers
      });

      // Update WorkspaceMembers document
      const workspaceId = selectedProject.workspaceId;
      const memberRef = doc(db, 'WorkspaceMembers', `${workspaceId}_${userId}`);
      await updateDoc(memberRef, { role: newRole });

      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'UPDATE_PROJECT_MEMBER_ROLE',
        details: `Updated role of user in project "${selectedProject.projectName}" to ${newRole}`,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("Error updating member role:", err);
      alert("Failed to update member role: " + err.message);
    }
  }

  // Handle Delete Project (Owner Only)
  async function handleDeleteProject(project) {
    if (!project) return;
    if (project.ownerId !== currentUser.uid) {
      alert("Only the project owner can delete this project!");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete project "${project.projectName}"? This action is permanent and will delete all project workspaces, members, tasks, and repository connections.`)) {
      return;
    }

    try {
      const workspaceId = project.workspaceId;
      const projectId = project.id;

      // 1. Delete project document
      await deleteDoc(doc(db, 'Projects', projectId));

      // 2. Delete room document
      await deleteDoc(doc(db, 'Rooms', workspaceId));

      // 3. Delete RepositoryConnection if exists
      await deleteDoc(doc(db, 'RepositoryConnections', workspaceId));

      // 4. Delete all WorkspaceMembers docs for this workspace
      const membersQuery = query(collection(db, 'WorkspaceMembers'), where('workspaceId', '==', workspaceId));
      const membersSnap = await getDocs(membersQuery);
      for (const d of membersSnap.docs) {
        await deleteDoc(d.ref);
      }

      // 5. Delete all Tasks docs for this workspace
      const tasksQuery = query(collection(db, 'Tasks'), where('workspaceId', '==', workspaceId));
      const tasksSnap = await getDocs(tasksQuery);
      for (const d of tasksSnap.docs) {
        await deleteDoc(d.ref);
      }

      // Log activity
      await addDoc(collection(db, 'Activities'), {
        userId: currentUser.uid,
        action: 'DELETE_PROJECT',
        details: `Deleted team project "${project.projectName}"`,
        timestamp: serverTimestamp()
      });

      alert("Project deleted successfully!");
      setSelectedProjectId(null);
      setSelectedProject(null);
    } catch (err) {
      console.error("Error deleting project:", err);
      alert("Failed to delete project: " + err.message);
    }
  }

  // Helper: Get Badge Color for Role
  function getRoleBadge(role) {
    switch(role) {
      case 'owner': return <Badge bg="danger" className="rounded-pill py-1 px-2">Owner</Badge>;
      case 'lead_developer': return <Badge bg="warning" text="dark" className="rounded-pill py-1 px-2">Lead Developer</Badge>;
      case 'developer': return <Badge bg="success" className="rounded-pill py-1 px-2">Developer</Badge>;
      case 'viewer': return <Badge bg="secondary" className="rounded-pill py-1 px-2">Viewer</Badge>;
      default: return <Badge bg="info" className="rounded-pill py-1 px-2">{role}</Badge>;
    }
  }

  // Helper: Check if current user is owner
  const isOwner = selectedProject && selectedProject.ownerId === currentUser.uid;
  const currentMemberInfo = selectedProject && selectedProject.teamMembers.find(m => m.userId === currentUser.uid);
  const currentUserRole = currentMemberInfo ? currentMemberInfo.role : 'viewer';

  // Render Projects List View
  if (!selectedProjectId) {
    return (
      <div className="container-fluid py-4" style={{ height: 'calc(100vh - 64px)', overflowY: 'auto', backgroundColor: 'var(--bg-dark)' }}>
        {/* Header */}
        <div className="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <h4 className="fw-bold theme-text-primary mb-1">Team Projects</h4>
            <p className="text-muted small mb-0">Manage and collaborate on your team's code bases</p>
          </div>
          <Button 
            className="custom-cyan-button d-flex align-items-center gap-2"
            onClick={() => setShowCreateModal(true)}
          >
            <FolderPlus size={16} /> Create Team Project
          </Button>
        </div>

        {/* Projects Grid */}
        {loading ? (
          <div className="d-flex flex-column align-items-center justify-content-center py-5 text-muted">
            <Loader size={36} className="spinner-rotate mb-2 text-info" />
            <span>Loading projects...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-5 px-3 rounded-4" style={{ backgroundColor: 'var(--bg-card)', border: '1px dashed var(--border-subtle)', marginTop: '20px' }}>
            <FolderOpen size={48} className="text-muted mb-3 opacity-30" />
            <h5 className="fw-bold theme-text-primary">No Projects Found</h5>
            <p className="text-muted small mx-auto mb-4" style={{ maxWidth: '360px' }}>
              You are not registered in any team projects yet. Create a new project or ask your project owner to invite you.
            </p>
            <Button variant="outline-info" size="sm" onClick={() => setShowCreateModal(true)} style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
              Create Your First Project
            </Button>
          </div>
        ) : (
          <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
            {projects.map(project => {
              const connectedRepoName = project.githubRepository || '';
              const myInfo = project.teamMembers?.find(m => m.userId === currentUser.uid);
              const myRole = myInfo ? myInfo.role : 'viewer';

              return (
                <div key={project.id} className="col">
                  <Card 
                    className="h-100 border-0 rounded-4 card-glow transition-all"
                    style={{ backgroundColor: 'var(--bg-card)', cursor: 'pointer' }}
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setSelectedProject(project);
                    }}
                  >
                    <Card.Body className="p-4 d-flex flex-column">
                      <div className="d-flex align-items-center justify-content-between mb-3">
                        <Badge bg={theme === 'dark' ? 'dark' : 'light'} className="border border-secondary border-opacity-40 text-info px-2.5 py-1.5" style={{ fontSize: '10px' }}>
                          <Cpu size={10} className="me-1" /> {project.stack}
                        </Badge>
                        <div className="d-flex align-items-center gap-2">
                          {getRoleBadge(myRole)}
                          {project.ownerId === currentUser.uid && (
                            <Button
                              variant="link"
                              className="p-0 text-danger border-0 d-flex align-items-center justify-content-center"
                              style={{ width: '24px', height: '24px', borderRadius: '4px', transition: 'background-color 0.2s' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteProject(project);
                              }}
                              onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(220, 53, 69, 0.15)'}
                              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                              title="Delete Project"
                            >
                              <Trash2 size={13} style={{ pointerEvents: 'none' }} />
                            </Button>
                          )}
                        </div>
                      </div>

                      <h5 className="fw-bold theme-text-primary mb-2 text-truncate">{project.projectName}</h5>
                      <p className="text-muted small text-clamp mb-4 flex-grow-1" style={{ fontSize: '12.5px', height: '36px', overflow: 'hidden' }}>
                        {project.description || 'No description provided.'}
                      </p>

                      <div className="d-flex align-items-center justify-content-between border-top border-secondary border-opacity-30 pt-3 text-muted" style={{ fontSize: '11px' }}>
                        <div className="d-flex align-items-center gap-1.5">
                          <Users size={12} className="text-warning" />
                          <span>{project.teamMembers?.length || 1} members</span>
                        </div>
                        <div className="d-flex align-items-center gap-1.5">
                          <Activity size={12} className="text-success" />
                          <span style={{ textTransform: 'capitalize' }}>{project.status}</span>
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                </div>
              );
            })}
          </div>
        )}

        {/* Create Project Modal */}
        <Modal 
          show={showCreateModal} 
          onHide={() => { setShowCreateModal(false); setNewProjectMembers([]); }} 
          centered 
          size="lg"
          contentClassName="theme-modal border-secondary"
        >
          <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="border-secondary">
            <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
              <FolderPlus size={20} className="me-2 text-info" /> Create Team Project
            </Modal.Title>
          </Modal.Header>
          <Modal.Body className="p-4">
            <Form onSubmit={handleCreateProjectSubmit}>
              <div className="row">
                <div className="col-md-6 border-end border-secondary border-opacity-40">
                  <Form.Group className="mb-3">
                    <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>PROJECT NAME</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="E.g. E-Commerce Backend"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className="small"
                      required
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>DESCRIPTION</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={3}
                      placeholder="Describe the project goals..."
                      value={projectDesc}
                      onChange={(e) => setProjectDesc(e.target.value)}
                      className="small"
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>TECHNOLOGY STACK</Form.Label>
                    <Form.Select
                      value={projectStack}
                      onChange={(e) => setProjectStack(e.target.value)}
                      className="small"
                    >
                      <option value="React">React (Vite)</option>
                      <option value="Node.js">Node.js / Express</option>
                      <option value="Python">Python</option>
                      <option value="Rust">Rust</option>
                      <option value="Go">Go</option>
                      <option value="HTML/CSS/JS">HTML/CSS/JS</option>
                    </Form.Select>
                  </Form.Group>
                </div>

                <div className="col-md-6 ps-md-4">
                  <div className="text-muted small fw-bold mb-2" style={{ fontSize: '11px' }}>ASSIGN TEAM MEMBERS</div>
                  
                  {/* Inline Add Member */}
                  <div className="p-2.5 rounded-3 mb-3" style={{ backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
                    <Form.Group className="mb-2">
                      <Form.Label className="small text-muted mb-1" style={{ fontSize: '10px' }}>DEVELOPER EMAIL</Form.Label>
                      <Form.Control
                        type="email"
                        placeholder="Enter email to search..."
                        value={memberEmailInput}
                        onChange={(e) => setMemberEmailInput(e.target.value)}
                        className="small"
                        style={{ height: '30px', fontSize: '11.5px' }}
                      />
                    </Form.Group>
                    <div className="d-flex align-items-center gap-2">
                      <Form.Select
                        value={memberRoleInput}
                        onChange={(e) => setMemberRoleInput(e.target.value)}
                        className="small py-0 px-2 flex-grow-1"
                        style={{ height: '28px', fontSize: '11.5px' }}
                      >
                        <option value="lead_developer">Lead Developer</option>
                        <option value="developer">Developer</option>
                        <option value="viewer">Viewer</option>
                      </Form.Select>
                      <Button 
                        size="sm" 
                        variant="info" 
                        onClick={handleAddMemberToCreateList}
                        className="px-3"
                        style={{ fontSize: '11px', height: '28px', fontWeight: 'bold' }}
                      >
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Temporary Members List */}
                  <div className="text-muted small fw-bold mb-1.5" style={{ fontSize: '10px' }}>ASSIGNED ({newProjectMembers.length})</div>
                  <div className="overflow-auto custom-scrollbar pr-1" style={{ maxHeight: '140px', minHeight: '60px' }}>
                    {newProjectMembers.length === 0 ? (
                      <div className="text-muted small text-center py-3">No members added yet.</div>
                    ) : (
                      newProjectMembers.map(m => (
                        <div key={m.email} className="d-flex align-items-center justify-content-between p-2 rounded-3 mb-1.5 theme-bg-secondary border border-secondary border-opacity-30">
                          <div className="text-truncate">
                            <div className="fw-semibold small text-truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</div>
                            <div className="text-muted text-truncate" style={{ fontSize: '10.5px' }}>{m.email}</div>
                          </div>
                          <div className="d-flex align-items-center gap-2 flex-shrink-0">
                            {getRoleBadge(m.role)}
                            <button 
                              type="button" 
                              onClick={() => handleRemoveFromCreateList(m.email)}
                              className="btn btn-link p-0 text-danger border-0"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="d-flex justify-content-end gap-2 mt-4 pt-3 border-top border-secondary border-opacity-40">
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={() => { setShowCreateModal(false); setNewProjectMembers([]); }}
                >
                  Cancel
                </Button>
                <Button 
                  variant="primary" 
                  size="sm" 
                  type="submit" 
                  disabled={creatingProject || !projectName.trim()}
                  style={{ background: 'var(--primary-gradient)', border: 'none' }}
                >
                  {creatingProject ? <><Loader size={12} className="spinner-rotate me-1" /> Creating...</> : 'Create Project'}
                </Button>
              </div>
            </Form>
          </Modal.Body>
        </Modal>
      </div>
    );
  }

  // Render Selected Project Dashboard View
  return (
    <div className="container-fluid py-4" style={{ height: 'calc(100vh - 64px)', overflowY: 'auto', backgroundColor: 'var(--bg-dark)' }}>
      {/* Back link & Actions */}
      <div className="d-flex align-items-center justify-content-between mb-4 pb-3 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
        <button 
          onClick={() => { setSelectedProjectId(null); setSelectedProject(null); }}
          className="btn btn-link p-0 text-decoration-none text-muted d-inline-flex align-items-center gap-2 border-0"
          style={{ fontSize: '13px', outline: 'none', boxShadow: 'none' }}
        >
          <ArrowLeft size={16} /> Back to Projects
        </button>

        <div className="d-flex align-items-center gap-2">
          {selectedProject.ownerId === currentUser.uid && (
            <Button
              variant="outline-danger"
              className="d-flex align-items-center justify-content-center gap-2 px-3 py-2 fw-bold rounded-3"
              style={{ fontSize: '13px' }}
              onClick={() => handleDeleteProject(selectedProject)}
            >
              <Trash2 size={14} /> Delete Project
            </Button>
          )}
          <Button
            variant="primary"
            className="d-flex align-items-center justify-content-center gap-2 px-4 py-2 border-0 fw-bold rounded-3"
            style={{ background: 'var(--primary-gradient)' }}
            onClick={() => navigate(`/?room=${selectedProject.workspaceId}`)}
          >
            <Play size={14} fill="currentColor" /> Open Workspace in IDE
          </Button>
        </div>
      </div>

      <div className="row g-4">
        {/* Left Side: Project details */}
        <div className="col-lg-5">
          <Card className="border-0 rounded-4 mb-4" style={{ backgroundColor: 'var(--bg-card)' }}>
            <Card.Body className="p-4">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <Badge bg={theme === 'dark' ? 'dark' : 'light'} className="border border-secondary border-opacity-40 text-info px-2.5 py-1.5" style={{ fontSize: '10.5px' }}>
                  <Cpu size={10} className="me-1" /> {selectedProject.stack}
                </Badge>
                <Badge bg="success" className="py-1 px-2.5 rounded-pill" style={{ textTransform: 'capitalize', fontSize: '10.5px' }}>
                  {selectedProject.status}
                </Badge>
              </div>

              <h4 className="fw-bold theme-text-primary mb-2">{selectedProject.projectName}</h4>
              <p className="text-muted small mb-4" style={{ fontSize: '13px', lineHeight: '1.6' }}>
                {selectedProject.description || 'No description provided.'}
              </p>

              {/* Connected GitHub Repository */}
              <div className="p-3 rounded-3 mb-3 theme-bg-secondary border border-secondary border-opacity-30">
                <div className="text-muted small mb-1.5" style={{ fontSize: '10px', fontWeight: 'bold' }}>CONNECTED REPOSITORY</div>
                {repoConnection ? (
                  <div className="d-flex align-items-center justify-content-between">
                    <div className="d-flex align-items-center gap-2 text-truncate">
                      <span style={{ fontSize: '16px' }}>🐙</span>
                      <div className="text-truncate">
                        <div className="fw-bold theme-text-primary small text-truncate" style={{ fontSize: '12px' }}>
                          {repoConnection.repoOwner}/{repoConnection.repoName}
                        </div>
                        <div className="text-muted small text-truncate" style={{ fontSize: '10px' }}>
                          Active branch: <span className="text-warning fw-semibold">{repoConnection.branchName}</span>
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="link" 
                      className="p-0 text-info text-decoration-none small flex-shrink-0"
                      style={{ fontSize: '11px', outline: 'none', boxShadow: 'none' }}
                      onClick={() => navigate(`/?room=${selectedProject.workspaceId}`)}
                    >
                      View Code
                    </Button>
                  </div>
                ) : (
                  <div className="d-flex align-items-center justify-content-between">
                    <span className="text-muted small" style={{ fontSize: '11.5px' }}>No repository connected.</span>
                    {currentUserRole === 'owner' && (
                      <Button 
                        variant="link" 
                        className="p-0 text-info text-decoration-none small flex-shrink-0"
                        style={{ fontSize: '11.5px', outline: 'none', boxShadow: 'none', fontWeight: 'bold' }}
                        onClick={() => navigate(`/?room=${selectedProject.workspaceId}`)}
                      >
                        Connect Repository
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Workspace ID Info */}
              <div className="d-flex justify-content-between text-muted" style={{ fontSize: '11px' }}>
                <span>Workspace ID:</span>
                <span className="font-monospace theme-text-primary fw-bold">{selectedProject.workspaceId}</span>
              </div>
            </Card.Body>
          </Card>

          {/* Real-time Active Developers Panel */}
          <Card className="border-0 rounded-4" style={{ backgroundColor: 'var(--bg-card)' }}>
            <Card.Body className="p-4">
              <h6 className="fw-bold theme-text-primary mb-3 d-flex align-items-center gap-2">
                <span className="presence-dot" style={{ width: '8px', height: '8px', backgroundColor: '#10b981', display: 'inline-block' }} />
                <span>Active Developers in IDE ({activeDevs.length})</span>
              </h6>
              {activeDevs.length === 0 ? (
                <div className="text-muted small text-center py-4 rounded-3 theme-bg-secondary" style={{ border: '1px dashed var(--border-subtle)' }}>
                  No developers are currently working in the workspace.
                </div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {activeDevs.map((dev, idx) => {
                    const devColor = dev.uid ? getUserColor(dev.uid) : '#6c6c6c';
                    return (
                      <div key={idx} className="d-flex align-items-center justify-content-between p-2 rounded-3 theme-bg-secondary border border-secondary border-opacity-20">
                        <div className="d-flex align-items-center gap-2.5 text-truncate">
                          <div 
                            className="rounded-circle d-flex align-items-center justify-content-center fw-bold text-white text-uppercase"
                            style={{ width: '26px', height: '26px', fontSize: '11px', backgroundColor: devColor }}
                          >
                            {dev.name?.charAt(0) || 'D'}
                          </div>
                          <div className="text-truncate">
                            <span className="fw-semibold theme-text-primary small" style={{ fontSize: '12px' }}>{dev.name}</span>
                            <div className="text-muted text-truncate" style={{ fontSize: '10.5px' }}>
                              {dev.file ? `Working on: ${dev.file.split('/').pop()}` : 'Idle'}
                            </div>
                          </div>
                        </div>
                        <Badge bg="success" className="rounded-pill px-2 py-1 flex-shrink-0" style={{ fontSize: '9px' }}>Online</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>
        </div>

        {/* Right Side: Team Member Management */}
        <div className="col-lg-7">
          <Card className="border-0 rounded-4" style={{ backgroundColor: 'var(--bg-card)', height: '100%' }}>
            <Card.Body className="p-4 d-flex flex-column" style={{ minHeight: '400px' }}>
              <div className="d-flex align-items-center justify-content-between mb-4">
                <div>
                  <h6 className="fw-bold theme-text-primary mb-1 d-flex align-items-center gap-2">
                    <Users size={16} className="text-info" />
                    <span>Project Team Members ({selectedProject.teamMembers?.length || 1})</span>
                  </h6>
                  <p className="text-muted small mb-0" style={{ fontSize: '11px' }}>Manage developers and assign access roles</p>
                </div>
                {currentUserRole === 'owner' && (
                  <Button 
                    size="sm"
                    className="custom-cyan-button d-flex align-items-center gap-1.5 py-1.5 px-3 rounded-3 font-semibold"
                    style={{ fontSize: '11.5px' }}
                    onClick={() => setShowAddMemberModal(true)}
                  >
                    <Plus size={13} /> Add Member
                  </Button>
                )}
              </div>

              {/* Members Table */}
              <div className="table-responsive rounded-3 overflow-hidden flex-grow-1" style={{ border: '1px solid var(--border-subtle)' }}>
                <Table hover variant={theme === 'dark' ? 'dark' : undefined} className="align-middle mb-0">
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <th className="border-0 text-muted small px-3 py-2.5">MEMBER</th>
                      <th className="border-0 text-muted small px-3 py-2.5">ROLE</th>
                      {currentUserRole === 'owner' && <th className="border-0 text-muted small px-3 py-2.5 text-end">ACTIONS</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProject.teamMembers?.map(member => (
                      <tr key={member.userId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td className="px-3 py-2.5">
                          <div className="fw-semibold small" style={{ color: 'var(--text-primary)' }}>{member.name} {member.userId === currentUser.uid && '(You)'}</div>
                          <div className="text-muted" style={{ fontSize: '11px' }}>{member.email}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          {member.role === 'owner' ? (
                            getRoleBadge('owner')
                          ) : currentUserRole === 'owner' ? (
                            <Form.Select
                              size="sm"
                              value={member.role}
                              onChange={(e) => handleUpdateDashboardMemberRole(member.userId, e.target.value)}
                              className="small py-0 px-2"
                              style={{ fontSize: '11px', width: '130px', height: '24px' }}
                            >
                              <option value="lead_developer">Lead Developer</option>
                              <option value="developer">Developer</option>
                              <option value="viewer">Viewer</option>
                            </Form.Select>
                          ) : (
                            getRoleBadge(member.role)
                          )}
                        </td>
                        {currentUserRole === 'owner' && (
                          <td className="px-3 py-2.5 text-end">
                            {member.userId !== currentUser.uid && (
                              <Button 
                                size="sm" 
                                variant="outline-danger"
                                className="d-inline-flex align-items-center gap-1 rounded-pill"
                                style={{ fontSize: '10.5px', padding: '2px 10px' }}
                                onClick={() => handleRemoveDashboardMember(member.userId, member.email)}
                              >
                                <Trash2 size={11} /> Remove
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Add Member Modal (Dashboard) */}
      <Modal 
        show={showAddMemberModal} 
        onHide={() => { setShowAddMemberModal(false); setAddEmailInput(''); }} 
        centered 
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="border-secondary">
          <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
            <Plus size={20} className="me-2 text-info" /> Add Member to Project
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4">
          <Form onSubmit={handleAddDashboardMemberSubmit}>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>DEVELOPER EMAIL</Form.Label>
              <Form.Control
                type="email"
                placeholder="developer@example.com"
                value={addEmailInput}
                onChange={(e) => setAddEmailInput(e.target.value)}
                className="small"
                required
                autoFocus
              />
              <Form.Text className="text-muted small">
                The developer must be registered in the system before they can be added to a project.
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'bold' }}>PROJECT ROLE</Form.Label>
              <Form.Select
                value={addRoleInput}
                onChange={(e) => setAddRoleInput(e.target.value)}
                className="small"
              >
                <option value="lead_developer">Lead Developer (Manage branches & pull & edit)</option>
                <option value="developer">Developer (Edit & commit code)</option>
                <option value="viewer">Viewer (Read-only access)</option>
              </Form.Select>
            </Form.Group>

            <div className="d-flex justify-content-end gap-2 mt-4 pt-3 border-top border-secondary border-opacity-40">
              <Button 
                variant="secondary" 
                size="sm" 
                onClick={() => { setShowAddMemberModal(false); setAddEmailInput(''); }}
              >
                Cancel
              </Button>
              <Button 
                variant="primary" 
                size="sm" 
                type="submit" 
                disabled={addingMember || !addEmailInput.trim()}
                style={{ background: 'var(--primary-gradient)', border: 'none' }}
              >
                {addingMember ? <><Loader size={12} className="spinner-rotate me-1" /> Adding...</> : 'Add Member'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </div>
  );
}

// Inline helper to resolve online developer initials user colors
function getUserColor(uid) {
  const colors = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#6366f1'
  ];
  if (!uid) return colors[0];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}
