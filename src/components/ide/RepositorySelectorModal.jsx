import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../firebase';
import GitHubService from '../../services/githubService';
import { 
  doc, 
  setDoc, 
  onSnapshot, 
  addDoc, 
  collection, 
  serverTimestamp 
} from 'firebase/firestore';
import { Modal, Button, Form, InputGroup, Spinner, Card, Badge, Nav } from 'react-bootstrap';
import { Search, FolderGit, Plus, Globe, Lock, RefreshCw, CheckCircle, AlertTriangle, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';

export default function RepositorySelectorModal({ show, onHide, roomId }) {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('browse'); // 'browse' | 'create'
  
  // Connection states
  const [githubConn, setGithubConn] = useState(null);
  const [loadingConn, setLoadingConn] = useState(true);

  // Browse Repos States
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'public', 'private'
  const [sortBy, setSortBy] = useState('updated'); // 'updated', 'name'
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Create Repo States
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [newRepoReadme, setNewRepoReadme] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  // Import State
  const [isImporting, setIsImporting] = useState(null); // repo id of currently importing repo
  const [currentConnection, setCurrentConnection] = useState(null);

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
      setLoadingConn(false);
    }, (err) => {
      console.error("Error fetching GitHub connections in modal:", err);
      setLoadingConn(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Subscribe to current repository connection for this workspace
  useEffect(() => {
    if (!roomId) return;
    const ref = doc(db, 'RepositoryConnections', roomId);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (snapshot.exists()) {
        setCurrentConnection(snapshot.data());
      } else {
        setCurrentConnection(null);
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  // Fetch repositories from server API
  async function fetchRepositories() {
    if (!currentUser || !githubConn) return;
    setLoadingRepos(true);
    setRepoError('');
    try {
      const fetchedRepos = await GitHubService.fetchRepositories(currentUser.uid, githubConn.accessToken);
      setRepos(fetchedRepos || []);
      setCurrentPage(1); // Reset page on refresh
    } catch (err) {
      console.error("Error loading repositories in modal:", err);
      setRepoError(err.message);
    } finally {
      setLoadingRepos(false);
    }
  }

  // Fetch repos when connection succeeds or modal opens
  useEffect(() => {
    if (show && githubConn) {
      fetchRepositories();
    }
  }, [show, githubConn]);

  // Handle Import/Clone Repository
  async function handleImportRepository(repo) {
    if (!roomId) return;
    setIsImporting(repo.id);

    try {
      const repoOwner = repo.owner || githubConn.githubUsername;
      
      // 1. Trigger backend gitClone to clone files on disk
      const cloneResult = await GitHubService.gitClone(
        currentUser.uid,
        githubConn.accessToken,
        roomId,
        repoOwner,
        repo.name,
        repo.default_branch
      );

      const initialFilePath = cloneResult.defaultFile || 'README.md';
      const initialContent = cloneResult.content || `# Imported Repository: ${repo.name}\n\nStart editing to commit your changes!`;

      // 2. Set repository connection in Firestore
      await setDoc(doc(db, 'RepositoryConnections', roomId), {
        workspaceId: roomId,
        userId: currentUser.uid,
        repoName: repo.name,
        repoOwner: repoOwner,
        repoUrl: repo.html_url,
        branchName: repo.default_branch || 'main',
        activeFilePath: initialFilePath,
        originalContent: initialContent,
        syncedAt: serverTimestamp(),
        autoSyncEnabled: false,
        syncInterval: 5,
        autoCommitMessage: 'Auto-sync: updates in {file}'
      });

      // 3. Log git activity
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email.split('@')[0],
        repoName: repo.name,
        commitMessage: `Imported repository ${repoOwner}/${repo.name}`,
        actionType: 'clone',
        branchName: repo.default_branch || 'main',
        createdAt: serverTimestamp()
      });

      onHide();
    } catch (err) {
      console.error("Error importing repository in modal:", err);
      alert("Failed to import repository: " + err.message);
    } finally {
      setIsImporting(null);
    }
  }

  // Handle Create Repo Submission
  async function handleCreateRepo(e) {
    e.preventDefault();
    if (!newRepoName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const newRepo = await GitHubService.createRepository(currentUser.uid, githubConn.accessToken, {
        name: newRepoName.trim(),
        description: newRepoDesc.trim(),
        isPrivate: newRepoPrivate,
        initReadme: newRepoReadme
      });

      // Auto import the newly created repo
      await handleImportRepository(newRepo);

      // Reset fields
      setNewRepoName('');
      setNewRepoDesc('');
      setNewRepoPrivate(false);
      setActiveTab('browse');
    } catch (err) {
      console.error("Error creating repository in modal:", err);
      alert("Error: " + err.message);
    } finally {
      setIsCreating(false);
    }
  }

  // Filter and sort repos list
  const processedRepos = repos
    .filter(repo => {
      const matchesSearch = repo.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase()));
      if (filterType === 'all') return matchesSearch;
      if (filterType === 'private') return matchesSearch && repo.private;
      if (filterType === 'public') return matchesSearch && !repo.private;
      return matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      } else {
        return new Date(b.updated_at) - new Date(a.updated_at);
      }
    });

  // Calculate Pagination values
  const totalPages = Math.max(1, Math.ceil(processedRepos.length / itemsPerPage));
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentRepos = processedRepos.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="lg"
      contentClassName="theme-modal text-light border-secondary"
      style={{ backdropFilter: 'blur(4px)' }}
    >
      <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="border-secondary px-4 py-3">
        <Modal.Title className="d-flex align-items-center gap-2 theme-text-primary fw-bold" style={{ fontSize: '18px' }}>
          <FolderGit size={20} className="text-info" />
          <span>GitHub Workspace Integration</span>
        </Modal.Title>
      </Modal.Header>

      <Modal.Body className="p-4" style={{ minHeight: '400px' }}>
        {loadingConn ? (
          <div className="d-flex flex-column align-items-center justify-content-center p-5 text-muted h-100">
            <Spinner animation="border" size="md" className="mb-3 text-info" />
            <span>Checking GitHub connection status...</span>
          </div>
        ) : !githubConn ? (
          <div className="text-center py-5 d-flex flex-column align-items-center justify-content-center h-100">
            <FolderGit size={56} className="text-muted mb-3 opacity-40" />
            <h5 className="fw-bold theme-text-primary mb-2">GitHub Account Not Linked</h5>
            <p className="text-muted small mb-4" style={{ maxWidth: '340px' }}>
              Connect your GitHub account in your profile settings to browse, import, or create repositories from the IDE workspace.
            </p>
            <Button 
              variant="outline-info" 
              className="rounded-pill px-4"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              onClick={() => {
                onHide();
                window.location.href = '/profile';
              }}
            >
              Go to Profile Settings
            </Button>
          </div>
        ) : (
          <>
            {/* Modal Tabs */}
            <Nav variant="tabs" activeKey={activeTab} onSelect={(key) => setActiveTab(key)} className="border-secondary mb-4">
              <Nav.Item>
                <Nav.Link 
                  eventKey="browse" 
                  className={`border-0 bg-transparent theme-text-secondary px-3 py-2 ${activeTab === 'browse' ? 'active-tab fw-bold text-info border-bottom-active' : 'opacity-60'}`}
                  style={{ cursor: 'pointer' }}
                >
                  Browse Repositories
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link 
                  eventKey="create" 
                  className={`border-0 bg-transparent theme-text-secondary px-3 py-2 ${activeTab === 'create' ? 'active-tab fw-bold text-info border-bottom-active' : 'opacity-60'}`}
                  style={{ cursor: 'pointer' }}
                >
                  Create Repository
                </Nav.Link>
              </Nav.Item>
            </Nav>

            {/* Tab Panels */}
            {activeTab === 'browse' ? (
              <div className="d-flex flex-column gap-3">
                {/* Search & Filter Header */}
                <div className="row g-2">
                  <div className="col-md-6">
                    <InputGroup size="sm">
                      <InputGroup.Text className="theme-bg-secondary theme-text-primary border-secondary">
                        <Search size={14} />
                      </InputGroup.Text>
                      <Form.Control
                        type="text"
                        placeholder="Search your repositories..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setCurrentPage(1); // reset to page 1 on search change
                        }}
                        className=""
                      />
                    </InputGroup>
                  </div>
                  <div className="col-6 col-md-3">
                    <Form.Select 
                      size="sm" 
                      className="" 
                      value={filterType} 
                      onChange={(e) => {
                        setFilterType(e.target.value);
                        setCurrentPage(1);
                      }}
                      style={{ fontSize: '12px' }}
                    >
                      <option value="all">All Types</option>
                      <option value="public">Public Repos</option>
                      <option value="private">Private Repos</option>
                    </Form.Select>
                  </div>
                  <div className="col-6 col-md-3">
                    <Form.Select 
                      size="sm" 
                      className="" 
                      value={sortBy} 
                      onChange={(e) => setSortBy(e.target.value)}
                      style={{ fontSize: '12px' }}
                    >
                      <option value="updated">Recently Updated</option>
                      <option value="name">Name (A-Z)</option>
                    </Form.Select>
                  </div>
                </div>

                {/* Repository List */}
                <div className="mt-2" style={{ minHeight: '220px' }}>
                  {repoError && (
                    <div className="text-center p-3 rounded-3 border border-danger bg-danger bg-opacity-10 text-danger small">
                      <AlertTriangle size={18} className="mb-2" />
                      <div>{repoError}</div>
                      <Button size="sm" variant="link" onClick={fetchRepositories} className="text-danger p-0 mt-1">Try again</Button>
                    </div>
                  )}

                  {loadingRepos ? (
                    <div className="text-center py-5 text-muted">
                      <Spinner animation="border" size="sm" variant="info" className="mb-2" />
                      <div className="small">Retrieving repositories...</div>
                    </div>
                  ) : currentRepos.length === 0 ? (
                    <div className="text-center py-5 text-muted small">No repositories found.</div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {currentRepos.map((repo) => {
                        const isCurrent = currentConnection && currentConnection.repoName === repo.name;
                        return (
                          <Card 
                            key={repo.id}
                            className="theme-bg-secondary border border-secondary border-opacity-40 rounded-3"
                          >
                            <Card.Body className="p-3 d-flex align-items-center justify-content-between gap-3">
                              <div className="text-truncate">
                                <div className="d-flex align-items-center gap-2 mb-1">
                                  <span className="fw-bold theme-text-primary small text-truncate" style={{ fontSize: '13.5px' }}>
                                    {repo.name}
                                  </span>
                                  <Badge bg={theme === 'dark' ? 'dark' : 'light'} className="border border-secondary border-opacity-40 text-muted rounded-pill py-1 px-2" style={{ fontSize: '9px' }}>
                                    {repo.private ? <Lock size={8} className="me-1" /> : <Globe size={8} className="me-1" />}
                                    {repo.private ? 'Private' : 'Public'}
                                  </Badge>
                                </div>
                                <div className="text-muted text-truncate" style={{ fontSize: '11px', maxWidth: '420px' }}>
                                  {repo.description || "No description provided."}
                                </div>
                                <div className="text-muted mt-2" style={{ fontSize: '10px' }}>
                                  Last updated {new Date(repo.updated_at).toLocaleDateString()}
                                </div>
                              </div>

                              <Button
                                size="sm"
                                variant={isCurrent ? "outline-secondary" : "outline-info"}
                                className="py-1 px-3 rounded-pill d-flex align-items-center gap-1"
                                style={{ 
                                  fontSize: '11.5px',
                                  borderColor: isCurrent ? 'var(--border-subtle)' : '#00d2ff',
                                  color: isCurrent ? 'var(--text-muted)' : '#000000',
                                  background: isCurrent ? 'transparent' : '#00d2ff'
                                }}
                                onClick={() => handleImportRepository(repo)}
                                disabled={isImporting !== null}
                              >
                                {isImporting === repo.id ? (
                                  <><Spinner animation="border" size="sm" style={{ width: '12px', height: '12px' }} /> Importing...</>
                                ) : isCurrent ? (
                                  'Re-import'
                                ) : (
                                  <span className="d-flex align-items-center gap-1">Import <ArrowRight size={11} /></span>
                                )}
                              </Button>
                            </Card.Body>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Pagination Controls */}
                {!loadingRepos && processedRepos.length > itemsPerPage && (
                  <div className="d-flex align-items-center justify-content-between border-top border-secondary pt-3 mt-2">
                    <span className="text-muted small">
                      Showing {indexOfFirstItem + 1} - {Math.min(indexOfLastItem, processedRepos.length)} of {processedRepos.length}
                    </span>
                    <div className="d-flex align-items-center gap-2">
                      <Button
                        variant="outline-secondary"
                        size="xs"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="py-1 px-2 border-secondary theme-text-primary"
                      >
                        <ChevronLeft size={14} />
                      </Button>
                      <span className="theme-text-primary small fw-bold px-2">Page {currentPage} of {totalPages}</span>
                      <Button
                        variant="outline-secondary"
                        size="xs"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="py-1 px-2 border-secondary theme-text-primary"
                      >
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Create Repository tab */
              <Form onSubmit={handleCreateRepo} className="d-flex flex-column gap-3">
                <Form.Group>
                  <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Repository Name</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="my-cool-project"
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value.replace(/[^a-zA-Z0-9_\-]/g, ''))}
                    className=""
                    required
                    autoFocus
                  />
                  <Form.Text className="text-muted small">
                    Use only alphanumeric characters, hyphens (-), and underscores (_).
                  </Form.Text>
                </Form.Group>

                <Form.Group>
                  <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Description (Optional)</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    placeholder="Provide a short description for your new repository..."
                    value={newRepoDesc}
                    onChange={(e) => setNewRepoDesc(e.target.value)}
                    className=""
                  />
                </Form.Group>

                <div className="d-flex gap-4 p-2 theme-bg-secondary border border-secondary border-opacity-40 rounded-3">
                  <Form.Check
                    type="radio"
                    id="modal-public-repo"
                    label={
                      <div className="d-flex flex-column ms-1">
                        <span className="theme-text-primary fw-bold small">Public</span>
                        <span className="text-muted" style={{ fontSize: '10.5px' }}>Anyone on the internet can see this repository.</span>
                      </div>
                    }
                    name="modal-repo-privacy"
                    checked={!newRepoPrivate}
                    onChange={() => setNewRepoPrivate(false)}
                    className="theme-text-primary"
                  />
                  <Form.Check
                    type="radio"
                    id="modal-private-repo"
                    label={
                      <div className="d-flex flex-column ms-1">
                        <span className="theme-text-primary fw-bold small">Private</span>
                        <span className="text-muted" style={{ fontSize: '10.5px' }}>Only you and specified cooperators can access.</span>
                      </div>
                    }
                    name="modal-repo-privacy"
                    checked={newRepoPrivate}
                    onChange={() => setNewRepoPrivate(true)}
                    className="theme-text-primary"
                  />
                </div>

                <Form.Group>
                  <Form.Check
                    type="checkbox"
                    id="modal-init-readme"
                    label="Initialize repository with a README"
                    checked={newRepoReadme}
                    onChange={(e) => setNewRepoReadme(e.target.checked)}
                    className="text-muted small"
                  />
                </Form.Group>

                <div className="d-flex justify-content-end gap-2 border-top border-secondary pt-3 mt-3">
                  <Button variant="outline-secondary" size="sm" onClick={() => setActiveTab('browse')}>
                    Back to Browse
                  </Button>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    type="submit" 
                    disabled={isCreating || !newRepoName.trim()}
                    style={{ background: 'var(--primary-gradient)', border: 'none', px: '4' }}
                  >
                    {isCreating ? (
                      <><Spinner animation="border" size="sm" className="me-1" style={{ width: '12px', height: '12px' }} /> Creating...</>
                    ) : (
                      'Create & Import'
                    )}
                  </Button>
                </div>
              </Form>
            )}
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
