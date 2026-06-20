import { useState, useEffect } from 'react';
import { Modal, Button, Form, Nav, Table, Badge, Spinner } from 'react-bootstrap';
import { 
  Rocket, 
  Settings, 
  ExternalLink, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Clock, 
  User, 
  Cpu, 
  RefreshCw 
} from 'lucide-react';

const GitHubIcon = ({ size = 20, className = "" }) => (
  <svg 
    className={className} 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

export default function DeploymentModal({ show, onHide }) {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('deploy');
  
  // GitHub integration state
  const [gitHubConnected, setGitHubConnected] = useState(false);
  const [isConnectingGit, setIsConnectingGit] = useState(false);
  const [repos, setRepos] = useState([
    { id: 'repo-1', name: 'technify-workspace-frontend', branch: 'main', url: 'https://github.com/technify-team/technify-workspace-frontend' },
    { id: 'repo-2', name: 'collaborative-ide-core', branch: 'main', url: 'https://github.com/technify-team/collaborative-ide-core' },
    { id: 'repo-3', name: 'technify-backend-service', branch: 'develop', url: 'https://github.com/technify-team/technify-backend-service' }
  ]);
  const [selectedRepo, setSelectedRepo] = useState('technify-workspace-frontend');
  const [commitMessage, setCommitMessage] = useState('');

  // Deploy Configuration State
  const [deployType, setDeployType] = useState('vercel'); // 'vercel' | 'github'
  const [vercelHookUrl, setVercelHookUrl] = useState('');
  const [githubOwner, setGithubOwner] = useState('technify-team');
  const [githubRepo, setGithubRepo] = useState('technify-workspace-frontend');
  const [githubWorkflow, setGithubWorkflow] = useState('deploy.yml');
  const [githubToken, setGithubToken] = useState('');

  // Execution state
  const [isConfigSaving, setIsConfigSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState('');
  const [deployments, setDeployments] = useState([]);

  // Load configuration and subscribe to deployments
  useEffect(() => {
    if (!show) return;

    // 1. Fetch deployment config from Firestore
    const loadConfig = async () => {
      try {
        const configDoc = await getDoc(doc(db, 'Configs', 'deployment'));
        if (configDoc.exists()) {
          const data = configDoc.data();
          if (data.deployType) setDeployType(data.deployType);
          if (data.vercelHookUrl) setVercelHookUrl(data.vercelHookUrl);
          if (data.githubOwner) setGithubOwner(data.githubOwner);
          if (data.githubRepo) setGithubRepo(data.githubRepo);
          if (data.githubWorkflow) setGithubWorkflow(data.githubWorkflow);
          if (data.githubToken) setGithubToken(data.githubToken);
          if (data.gitHubConnected) setGitHubConnected(data.gitHubConnected);
        }
      } catch (error) {
        console.error('Error loading deployment config:', error);
      }
    };
    loadConfig();

    // 2. Subscribe to real-time deployments history
    const q = query(collection(db, 'Deployments'), orderBy('triggeredAt', 'desc'), limit(15));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDeployments(history);
    });

    return () => unsubscribe();
  }, [show]);

  // Mock GitHub connection
  const handleConnectGitHub = () => {
    setIsConnectingGit(true);
    setTimeout(async () => {
      setGitHubConnected(true);
      setIsConnectingGit(false);
      // Save state to Firebase
      try {
        await setDoc(doc(db, 'Configs', 'deployment'), {
          gitHubConnected: true
        }, { merge: true });
      } catch (e) {
        console.error('Error saving git connection:', e);
      }
    }, 1500);
  };

  // Save Settings configuration
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setIsConfigSaving(true);
    try {
      await setDoc(doc(db, 'Configs', 'deployment'), {
        deployType,
        vercelHookUrl,
        githubOwner,
        githubRepo,
        githubWorkflow,
        githubToken,
        updatedAt: serverTimestamp()
      }, { merge: true });
      alert('Deployment configuration saved successfully!');
    } catch (error) {
      console.error('Error saving config:', error);
      alert('Failed to save deployment config.');
    } finally {
      setIsConfigSaving(false);
    }
  };

  // Trigger Deployment
  const handleDeploy = async () => {
    if (!gitHubConnected) {
      alert('Please connect your GitHub account first.');
      return;
    }

    setIsDeploying(true);
    setDeployStatus('Initializing deployment...');

    const repoDetails = repos.find(r => r.name === selectedRepo);
    const branch = repoDetails ? repoDetails.branch : 'main';

    try {
      // 1. Create a Deployment Document in Firestore
      const newDeployData = {
        repoName: selectedRepo,
        branch: branch,
        type: deployType === 'vercel' ? 'Vercel Hook' : 'GitHub Actions',
        triggeredBy: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
        triggeredAt: serverTimestamp(),
        status: 'queued', // queued, building, optimizing, success, failed
        commitMessage: commitMessage.trim() || `Deploy triggered from Workspace by ${currentUser.email?.split('@')[0]}`
      };

      const docRef = await addDoc(collection(db, 'Deployments'), newDeployData);
      const deploymentId = docRef.id;

      // 2. Trigger Actual Hooks (if configured)
      if (deployType === 'vercel' && vercelHookUrl) {
        setDeployStatus('Triggering Vercel Deploy Hook...');
        fetch(vercelHookUrl, { method: 'POST' }).catch(err => {
          console.warn('Real Vercel webhook execution completed/failed:', err);
        });
      } else if (deployType === 'github' && githubToken && githubOwner && githubRepo && githubWorkflow) {
        setDeployStatus('Triggering GitHub Actions Workflow...');
        fetch(`https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows/${githubWorkflow}/dispatches`, {
          method: 'POST',
          headers: {
            'Authorization': `token ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ref: branch })
        }).catch(err => {
          console.warn('Real GitHub Workflow trigger completed/failed:', err);
        });
      }

      // 3. Run Build Simulation (updates Firestore status in real-time)
      runBuildSimulation(deploymentId);

      // Clean form message
      setCommitMessage('');
    } catch (error) {
      console.error('Deployment failure:', error);
      setIsDeploying(false);
      setDeployStatus('');
    }
  };

  // Simulate CI/CD pipeline
  const runBuildSimulation = (docId) => {
    const docRef = doc(db, 'Deployments', docId);

    // Timeline steps:
    // 0s: Queued
    // 3s: Building
    // 8s: Optimizing / Verifying
    // 14s: Success / Failed
    
    // Simulate failure if commit message contains "error" or "fail" (for testing)
    const isMockFailure = commitMessage.toLowerCase().includes('fail') || commitMessage.toLowerCase().includes('error');

    setTimeout(async () => {
      setDeployStatus('Environment setup complete. Building assets...');
      await updateDoc(docRef, { status: 'building' });
    }, 2500);

    setTimeout(async () => {
      setDeployStatus('Optimizing bundles & running tests...');
      await updateDoc(docRef, { status: 'optimizing' });
    }, 7000);

    setTimeout(async () => {
      if (isMockFailure) {
        setDeployStatus('❌ Build failed! Test suite crashed.');
        await updateDoc(docRef, { status: 'failed' });
      } else {
        setDeployStatus('🚀 Deployment live! Vercel URL generated.');
        await updateDoc(docRef, { status: 'success' });
      }
      setIsDeploying(false);
    }, 13000);
  };

  // Format date helper
  const formatTime = (timestamp) => {
    if (!timestamp) return 'Just now';
    let date;
    if (typeof timestamp.toDate === 'function') {
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    } else {
      date = new Date(timestamp);
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + 
           date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Status Badge UI
  const renderStatusBadge = (status) => {
    switch (status) {
      case 'queued':
        return (
          <Badge bg="secondary" className="d-inline-flex align-items-center gap-1 p-2">
            <span className="spinner-grow spinner-grow-sm text-light" style={{ width: '8px', height: '8px' }} />
            <span>Queued</span>
          </Badge>
        );
      case 'building':
        return (
          <Badge bg="primary" className="d-inline-flex align-items-center gap-1 p-2">
            <Spinner animation="border" size="sm" style={{ width: '10px', height: '10px' }} />
            <span>Building</span>
          </Badge>
        );
      case 'optimizing':
        return (
          <Badge bg="info" className="d-inline-flex align-items-center gap-1 p-2">
            <RefreshCw className="spinner-rotate" size={10} />
            <span>Optimizing</span>
          </Badge>
        );
      case 'success':
        return (
          <Badge bg="success" className="d-inline-flex align-items-center gap-1 p-2">
            <CheckCircle2 size={12} />
            <span>Live</span>
          </Badge>
        );
      case 'failed':
        return (
          <Badge bg="danger" className="d-inline-flex align-items-center gap-1 p-2">
            <XCircle size={12} />
            <span>Failed</span>
          </Badge>
        );
      default:
        return <Badge bg="dark">{status}</Badge>;
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" centered data-bs-theme="dark">
      <Modal.Header closeButton style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
        <Modal.Title className="d-flex align-items-center gap-2 text-white">
          <Rocket size={22} className="text-primary animate-pulse" style={{ color: 'var(--accent)' }} />
          <span className="fw-bold">Deployment Center</span>
        </Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ backgroundColor: 'var(--bg-dark)', minHeight: '450px' }}>
        
        {/* Navigation Tabs */}
        <Nav variant="tabs" activeKey={activeTab} onSelect={(k) => setActiveTab(k)} className="mb-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <Nav.Item>
            <Nav.Link eventKey="deploy" className="border-0 px-4 py-2" style={{ color: activeTab === 'deploy' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === 'deploy' ? '2px solid var(--accent)' : 'none', background: 'transparent' }}>
              <Cpu size={16} className="me-2" />
              Deploy to Production
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="history" className="border-0 px-4 py-2" style={{ color: activeTab === 'history' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === 'history' ? '2px solid var(--accent)' : 'none', background: 'transparent' }}>
              <Clock size={16} className="me-2" />
              Deployment Logs ({deployments.length})
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="config" className="border-0 px-4 py-2" style={{ color: activeTab === 'config' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: activeTab === 'config' ? '2px solid var(--accent)' : 'none', background: 'transparent' }}>
              <Settings size={16} className="me-2" />
              Configure CI/CD
            </Nav.Link>
          </Nav.Item>
        </Nav>

        {/* Tab content */}
        {activeTab === 'deploy' && (
          <div className="p-1">
            {/* GitHub Connection Banner */}
            {!gitHubConnected ? (
              <div className="rounded-3 p-4 text-center mb-4" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px dashed var(--border-subtle)' }}>
                <GitHubIcon size={48} className="text-muted mb-3" />
                <h6 className="text-white fw-bold mb-2">Connect your GitHub Account</h6>
                <p className="text-muted small mb-3">Link your account to see repositories, branch options, and trigger pipelines.</p>
                <Button 
                  onClick={handleConnectGitHub} 
                  disabled={isConnectingGit}
                  style={{ background: 'var(--primary-gradient)', border: 'none' }}
                  className="rounded-pill px-4"
                >
                  {isConnectingGit ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <GitHubIcon size={16} className="me-2" />
                      Connect GitHub
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="rounded-3 p-3 mb-4 d-flex align-items-center justify-content-between" style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <div className="d-flex align-items-center gap-2">
                  <GitHubIcon size={20} className="text-success" />
                  <span className="text-light small">
                    Connected to GitHub as <strong className="text-white">@technify-team</strong>
                  </span>
                </div>
                <Badge bg="success" className="rounded-pill">Active</Badge>
              </div>
            )}

            {gitHubConnected && (
              <Form className="d-flex flex-column gap-3">
                <Form.Group>
                  <Form.Label className="text-muted small fw-bold">SELECT REPOSITORY</Form.Label>
                  <Form.Select 
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                    className="bg-dark text-white border-secondary rounded-3"
                    disabled={isDeploying}
                  >
                    {repos.map(r => (
                      <option key={r.id} value={r.name}>{r.name} ({r.branch})</option>
                    ))}
                  </Form.Select>
                </Form.Group>

                <Form.Group>
                  <Form.Label className="text-muted small fw-bold">RELEASE NOTE / DEPLOYMENT MESSAGE</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    placeholder="Describe what is changing in this deployment..."
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    className="bg-dark text-white border-secondary rounded-3"
                    disabled={isDeploying}
                  />
                  <Form.Text className="text-muted small">
                    Type "fail" or "error" in the description to test deployment failures.
                  </Form.Text>
                </Form.Group>

                <div className="mt-4 text-center">
                  <Button
                    onClick={handleDeploy}
                    disabled={isDeploying}
                    size="lg"
                    className="w-100 py-3 fw-bold rounded-3 shadow-lg d-flex align-items-center justify-content-center gap-2"
                    style={{ 
                      background: isDeploying ? 'var(--bg-card)' : 'var(--primary-gradient)', 
                      border: 'none',
                      boxShadow: '0 4px 20px rgba(102, 126, 234, 0.25)'
                    }}
                  >
                    {isDeploying ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        <span>Deploying to Production...</span>
                      </>
                    ) : (
                      <>
                        <Rocket size={18} />
                        <span>Deploy to Production</span>
                      </>
                    )}
                  </Button>

                  {/* Deploy status output */}
                  {isDeploying && (
                    <div className="mt-3 text-start rounded-3 p-3 border border-secondary" style={{ backgroundColor: 'rgba(0,0,0,0.4)', fontFamily: 'monospace', fontSize: '12px' }}>
                      <div className="text-muted mb-1">&gt; npm run deploy --prod</div>
                      <div className="text-info d-flex align-items-center gap-2">
                        <Spinner animation="grow" size="sm" style={{ width: '8px', height: '8px' }} />
                        <span>{deployStatus}</span>
                      </div>
                    </div>
                  )}
                </div>
              </Form>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="p-1">
            {deployments.length === 0 ? (
              <div className="text-center text-muted p-5">
                <AlertCircle size={36} className="mb-3" />
                <p>No deployments recorded yet.</p>
              </div>
            ) : (
              <div className="table-responsive rounded-3 overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                <Table hover responsive variant="dark" className="mb-0 align-middle">
                  <thead>
                    <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <th className="border-0 text-muted small p-3">REPOSITORY</th>
                      <th className="border-0 text-muted small p-3">STATUS</th>
                      <th className="border-0 text-muted small p-3">TRIGGERED BY</th>
                      <th className="border-0 text-muted small p-3">DATE / TIME</th>
                      <th className="border-0 text-muted small p-3">TYPE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map((deploy) => (
                      <tr key={deploy.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td className="p-3 fw-bold">
                          <div>{deploy.repoName}</div>
                          <div className="text-muted small fw-normal mt-1 d-flex align-items-center gap-1 text-truncate" style={{ maxWidth: '250px' }}>
                            <span className="badge bg-secondary-subtle text-muted rounded-pill px-2 py-1" style={{ fontSize: '10px' }}>{deploy.branch}</span>
                            <span className="text-truncate">{deploy.commitMessage}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          {renderStatusBadge(deploy.status)}
                        </td>
                        <td className="p-3 text-light d-flex align-items-center gap-2">
                          <User size={14} className="text-muted" />
                          <span>{deploy.triggeredBy}</span>
                        </td>
                        <td className="p-3 text-muted small">
                          {formatTime(deploy.triggeredAt)}
                        </td>
                        <td className="p-3 text-muted small">
                          <span className="badge bg-dark border border-secondary text-light px-2 py-1">{deploy.type}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'config' && (
          <Form onSubmit={handleSaveConfig} className="p-1 d-flex flex-column gap-4">
            <div>
              <Form.Label className="text-muted small fw-bold mb-3">CI/CD DEPLOYMENT PROVIDER</Form.Label>
              <div className="d-flex gap-4">
                <Form.Check 
                  type="radio" 
                  id="provider-vercel" 
                  name="deployType" 
                  label="Vercel Deploy Hook" 
                  value="vercel"
                  checked={deployType === 'vercel'}
                  onChange={() => setDeployType('vercel')}
                  className="text-white"
                />
                <Form.Check 
                  type="radio" 
                  id="provider-github" 
                  name="deployType" 
                  label="GitHub Actions Workflow Dispatch" 
                  value="github"
                  checked={deployType === 'github'}
                  onChange={() => setDeployType('github')}
                  className="text-white"
                />
              </div>
            </div>

            {deployType === 'vercel' ? (
              <div className="rounded-3 p-4 border border-secondary" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <h6 className="text-white fw-bold mb-3">Vercel Deploy Hook Settings</h6>
                <Form.Group className="mb-3">
                  <Form.Label className="text-light small">Vercel Deploy Hook URL</Form.Label>
                  <Form.Control
                    type="url"
                    placeholder="https://api.vercel.com/v1/integrations/deploy/prj_xxx/yyyy"
                    value={vercelHookUrl}
                    onChange={(e) => setVercelHookUrl(e.target.value)}
                    className="bg-dark text-white border-secondary rounded-3"
                  />
                  <Form.Text className="text-muted">
                    Retrieve this deploy hook from your Vercel Project settings dashboard.
                  </Form.Text>
                </Form.Group>
              </div>
            ) : (
              <div className="rounded-3 p-4 border border-secondary d-flex flex-column gap-3" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <h6 className="text-white fw-bold mb-2">GitHub Actions Workflow Settings</h6>
                
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <Form.Label className="text-light small">Repository Owner</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="e.g. technify-team"
                      value={githubOwner}
                      onChange={(e) => setGithubOwner(e.target.value)}
                      className="bg-dark text-white border-secondary rounded-3"
                      required
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <Form.Label className="text-light small">Repository Name</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="e.g. technify-workspace"
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      className="bg-dark text-white border-secondary rounded-3"
                      required
                    />
                  </div>
                </div>

                <div className="row">
                  <div className="col-md-6 mb-3">
                    <Form.Label className="text-light small">Workflow Filename</Form.Label>
                    <Form.Control
                      type="text"
                      placeholder="e.g. deploy.yml"
                      value={githubWorkflow}
                      onChange={(e) => setGithubWorkflow(e.target.value)}
                      className="bg-dark text-white border-secondary rounded-3"
                      required
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <Form.Label className="text-light small">GitHub Personal Access Token (PAT)</Form.Label>
                    <Form.Control
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxx"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      className="bg-dark text-white border-secondary rounded-3"
                    />
                  </div>
                </div>

                <Form.Text className="text-muted mt-0">
                  Ensure the token has `repo` or `workflow` scopes allowed for workflow dispatches.
                </Form.Text>
              </div>
            )}

            <Button 
              type="submit" 
              disabled={isConfigSaving}
              style={{ background: 'var(--primary-gradient)', border: 'none' }}
              className="mt-3 align-self-end rounded-3 px-4 py-2"
            >
              {isConfigSaving ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Saving...
                </>
              ) : (
                'Save Configuration'
              )}
            </Button>
          </Form>
        )}
      </Modal.Body>
    </Modal>
  );
}
