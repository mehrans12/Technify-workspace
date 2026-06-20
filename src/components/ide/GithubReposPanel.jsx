import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import GitHubService from '../../services/githubService';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  serverTimestamp,
  addDoc,
  collection 
} from 'firebase/firestore';
import { Button, Form, Spinner, Modal, InputGroup, Card, Badge } from 'react-bootstrap';
import { Search, FolderGit, Plus, Globe, Lock, RefreshCw, FileCode, CheckCircle, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

export default function GithubReposPanel({ roomId }) {
  const { currentUser } = useAuth();
  const [githubConn, setGithubConn] = useState(null);
  const [loadingConn, setLoadingConn] = useState(true);

  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState('');

  // Search, Filter, and Sort states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'public', 'private'
  const [sortBy, setSortBy] = useState('updated'); // 'updated', 'name'

  // Create Repo Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Reset page to 1 when filters or search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterType]);
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
      console.error("Error fetching GitHub connections:", err);
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
      const repos = await GitHubService.fetchRepositories(currentUser.uid, githubConn.accessToken);
      setRepos(repos);
    } catch (err) {
      console.error("Error loading repositories:", err);
      setRepoError(err.message);
    } finally {
      setLoadingRepos(false);
    }
  }

  // Fetch repos when connection succeeds
  useEffect(() => {
    if (githubConn) {
      fetchRepositories();
    } else {
      setRepos([]);
    }
  }, [githubConn]);

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

      setShowCreateModal(false);
      setNewRepoName('');
      setNewRepoDesc('');
      setNewRepoPrivate(false);
      
      // Refresh list
      fetchRepositories();
    } catch (err) {
      console.error("Error creating repo:", err);
      alert("Error: " + err.message);
    } finally {
      setIsCreating(false);
    }
  }

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

      // 4. Update collaborative editor if open
      alert(`Successfully imported repository ${repo.name}! Loaded file: ${initialFilePath}`);
    } catch (err) {
      console.error("Error importing repository:", err);
      alert("Failed to import repository: " + err.message);
    } finally {
      setIsImporting(null);
    }
  }

  // Filter and sort repos list in JS memory
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

  if (loadingConn) {
    return (
      <div className="d-flex align-items-center justify-content-center p-5 text-muted">
        <Spinner animation="border" size="sm" className="me-2 text-info" />
        Checking GitHub connection...
      </div>
    );
  }

  if (!githubConn) {
    return (
      <div className="p-4 text-center h-100 d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '300px' }}>
        <FolderGit size={48} className="text-muted mb-3 opacity-30" />
        <h6 className="fw-bold theme-text-primary mb-2">GitHub Integration</h6>
        <p className="text-muted small mb-4" style={{ maxWidth: '240px' }}>
          Connect your GitHub account in your Profile to browse repositories, clone codes, and commit directly.
        </p>
        <Button 
          variant="outline-info" 
          size="sm" 
          className="rounded-pill px-4"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          onClick={() => window.location.href = '/profile'}
        >
          Go to Profile Settings
        </Button>
      </div>
    );
  }

  return (
    <div className="d-flex flex-column h-100 p-3">
      {/* Panel Header */}
      <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom border-secondary">
        <h6 className="fw-bold theme-text-primary mb-0 d-flex align-items-center gap-2">
          <FolderGit size={16} className="text-info" />
          <span>GitHub Repositories</span>
        </h6>
        <div className="d-flex gap-1">
          <Button 
            variant="link" 
            className="p-1 text-muted d-flex align-items-center"
            onClick={fetchRepositories}
            disabled={loadingRepos}
          >
            <RefreshCw size={14} className={loadingRepos ? 'spinner-rotate' : ''} />
          </Button>
          <Button 
            variant="primary" 
            size="sm" 
            className="d-flex align-items-center gap-1 py-1 px-2 rounded-2"
            style={{ background: 'var(--primary-gradient)', border: 'none', fontSize: '11px' }}
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={12} /> New Repo
          </Button>
        </div>
      </div>

      {/* Active Repository connection display */}
      {currentConnection && (
        <Card className="border border-info bg-info bg-opacity-10 mb-3 rounded-3">
          <Card.Body className="p-2 d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2 text-truncate">
              <CheckCircle size={14} className="text-info" />
              <div className="text-truncate">
                <div className="fw-bold theme-text-primary" style={{ fontSize: '11.5px' }}>Connected to GitHub</div>
                <div className="text-muted text-truncate" style={{ fontSize: '10.5px' }}>
                  {currentConnection.repoOwner}/{currentConnection.repoName} ({currentConnection.branchName})
                </div>
              </div>
            </div>
            <Badge bg="info" className="py-1 px-2 rounded-pill" style={{ fontSize: '9px' }}>Active</Badge>
          </Card.Body>
        </Card>
      )}

      {/* Search and Filter Inputs */}
      <div className="d-flex flex-column gap-2 mb-3">
        <InputGroup size="sm">
          <InputGroup.Text className="bg-secondary text-light border-secondary">
            <Search size={12} />
          </InputGroup.Text>
          <Form.Control
            type="text"
            placeholder="Search repos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </InputGroup>

        <div className="d-flex gap-2">
          <Form.Select 
            size="sm" 
            value={filterType} 
            onChange={(e) => setFilterType(e.target.value)}
            style={{ fontSize: '11px' }}
          >
            <option value="all">All Types</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </Form.Select>

          <Form.Select 
            size="sm" 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
            style={{ fontSize: '11px' }}
          >
            <option value="updated">Recently Updated</option>
            <option value="name">Alphabetical</option>
          </Form.Select>
        </div>
      </div>

      {/* Repositories List */}
      <div className="flex-grow-1 overflow-auto d-flex flex-column gap-2 custom-scrollbarpr-1">
        {repoError && (
          <div className="text-center p-3 rounded-3 border border-danger bg-danger bg-opacity-10 text-danger small">
            <AlertTriangle size={16} className="mb-2" />
            <div>{repoError}</div>
            <Button size="xs" variant="link" onClick={fetchRepositories} className="text-danger p-0 mt-1">Try again</Button>
          </div>
        )}

        {loadingRepos ? (
          <div className="text-center py-5 text-muted">
            <Spinner animation="border" size="sm" variant="info" className="mb-2" />
            <div className="small">Loading repositories...</div>
          </div>
        ) : processedRepos.length === 0 ? (
          <div className="text-center py-5 text-muted small">No repositories found.</div>
        ) : (
          processedRepos.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((repo) => {
            const isCurrent = currentConnection && currentConnection.repoName === repo.name;
            return (
              <div 
                key={repo.id}
                className="p-2 rounded-3 border d-flex flex-column gap-2"
                style={{
                  backgroundColor: isCurrent ? 'rgba(0, 210, 255, 0.04)' : 'rgba(255,255,255,0.02)',
                  borderColor: isCurrent ? 'var(--accent)' : 'var(--border-subtle)'
                }}
              >
                <div className="d-flex align-items-start justify-content-between">
                  <div className="text-truncate">
                    <span className="fw-bold theme-text-primary small text-truncate d-block" style={{ fontSize: '12.5px' }}>
                      {repo.name}
                    </span>
                    <span className="text-muted d-block text-truncate" style={{ fontSize: '10.5px', height: '16px' }}>
                      {repo.description || "No description provided."}
                    </span>
                  </div>
                  <Badge bg="dark" className="border border-secondary text-muted rounded-pill" style={{ fontSize: '9px' }}>
                    {repo.private ? <Lock size={8} className="me-1" /> : <Globe size={8} className="me-1" />}
                    {repo.private ? 'Private' : 'Public'}
                  </Badge>
                </div>

                <div className="d-flex align-items-center justify-content-between mt-1">
                  <span className="text-muted" style={{ fontSize: '10px' }}>
                    Updated {new Date(repo.updated_at).toLocaleDateString()}
                  </span>
                  <Button
                    size="sm"
                    variant={isCurrent ? "outline-secondary" : "outline-primary"}
                    className="py-1 px-3 rounded-pill"
                    style={{ 
                      fontSize: '10.5px', 
                      color: isCurrent ? 'var(--text-muted)' : 'var(--accent)',
                      borderColor: isCurrent ? 'var(--border-subtle)' : 'var(--accent)'
                    }}
                    onClick={() => handleImportRepository(repo)}
                    disabled={isImporting !== null}
                  >
                    {isImporting === repo.id ? (
                      <><Spinner animation="border" size="sm" className="me-1" style={{ width: '10px', height: '10px' }} /> Importing...</>
                    ) : isCurrent ? (
                      'Re-import'
                    ) : (
                      'Import'
                    )}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Controls */}
      {!loadingRepos && processedRepos.length > itemsPerPage && (
        <div className="d-flex align-items-center justify-content-between border-top border-secondary pt-2 mt-2">
          <span className="text-muted" style={{ fontSize: '10px' }}>
            Page {currentPage} of {Math.ceil(processedRepos.length / itemsPerPage)}
          </span>
          <div className="d-flex gap-1">
            <Button
              variant="outline-secondary"
              size="xs"
              className="py-0 px-1 text-light border-secondary"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft size={12} />
            </Button>
            <Button
              variant="outline-secondary"
              size="xs"
              className="py-0 px-1 text-light border-secondary"
              onClick={() => setCurrentPage(prev => Math.min(Math.ceil(processedRepos.length / itemsPerPage), prev + 1))}
              disabled={currentPage === Math.ceil(processedRepos.length / itemsPerPage)}
            >
              <ChevronRight size={12} />
            </Button>
          </div>
        </div>
      )}

      {/* Create Repo Modal */}
      <Modal 
        show={showCreateModal} 
        onHide={() => setShowCreateModal(false)} 
        centered
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant="white" className="border-secondary">
          <Modal.Title style={{ fontSize: '16px' }} className="d-flex align-items-center gap-2">
            <FolderGit size={18} className="text-info" /> Create Repository
          </Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleCreateRepo}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Repository Name</Form.Label>
              <Form.Control
                type="text"
                placeholder="my-cool-project"
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value.replace(/[^a-zA-Z0-9_\-]/g, ''))}
                required
                autoFocus
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Description (Optional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Short project description..."
                value={newRepoDesc}
                onChange={(e) => setNewRepoDesc(e.target.value)}
              />
            </Form.Group>
            <Form.Group className="mb-3 d-flex align-items-center gap-4">
              <Form.Check
                type="radio"
                id="public-repo"
                label="Public"
                name="repo-privacy"
                checked={!newRepoPrivate}
                onChange={() => setNewRepoPrivate(false)}
                className="theme-text-primary small"
              />
              <Form.Check
                type="radio"
                id="private-repo"
                label="Private"
                name="repo-privacy"
                checked={newRepoPrivate}
                onChange={() => setNewRepoPrivate(true)}
                className="theme-text-primary small"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                id="init-readme"
                label="Initialize with a README"
                checked={newRepoReadme}
                onChange={(e) => setNewRepoReadme(e.target.checked)}
                className="text-muted small"
              />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer className="border-secondary">
            <Button variant="outline-secondary" size="sm" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              size="sm" 
              type="submit" 
              disabled={isCreating || !newRepoName.trim()}
              style={{ background: 'var(--primary-gradient)', border: 'none' }}
            >
              {isCreating ? 'Creating...' : 'Create & Import'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  );
}
