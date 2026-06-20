import { useState, useRef, useCallback, useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import AIAssistantPane from './ide/AIAssistantPane';
import CodeEditorPane from './ide/CodeEditorPane';
import PreviewPane from './ide/PreviewPane';
import GitPanel from './ide/GitPanel';
import GithubReposPanel from './ide/GithubReposPanel';
import FileExplorer, { extensionToLanguage } from './ide/FileExplorer';
import { executeCode } from '../utils/judge0';
import { GripVertical, MessageSquare, GitBranch, FolderOpen, Terminal, Globe, RefreshCw } from 'lucide-react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { io } from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext';

const Github = ({ size = 20, className = "" }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const PREVIEW_BASE_URL = import.meta.env.VITE_PREVIEW_URL || 'http://localhost:3000';

export default function Dashboard() {
  const [code] = useState('// Welcome to Technify Workspace\n\nfunction greet() {\n  console.log("Hello, World!");\n}\n\ngreet();');
  const [language, setLanguage] = useState('javascript');
  const editorRef = useRef(null);
  
  const [leftTab, setLeftTab] = useState('files'); // 'files', 'ai', 'git', 'github'
  const [rightTab, setRightTab] = useState('console'); // 'console' or 'preview'
  const iframeRef = useRef(null);

  const handleRefreshIframe = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'global';
  });

  useEffect(() => {
    if (roomId) {
      localStorage.setItem('activeRoom', roomId);
      const params = new URLSearchParams(window.location.search);
      if (params.get('room') !== roomId) {
        params.set('room', roomId);
        window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
      }
    }
  }, [roomId]);

  // Multi-file state
  const [activeFile, setActiveFile] = useState(null); // { path, name, content, language }
  const [openTabs, setOpenTabs] = useState([]); // [{ path, name, language }]

  // Reset active file and open tabs when room changes
  useEffect(() => {
    setActiveFile(null);
    setOpenTabs([]);
  }, [roomId]);

  const { currentUser } = useAuth();
  const [socket, setSocket] = useState(null);

  // Sync with global socket from MainLayout and join room
  useEffect(() => {
    if (!currentUser || !roomId) return;

    const name = currentUser.displayName || currentUser.email.split('@')[0];
    const joinData = {
      roomId,
      uid: currentUser.uid,
      name,
      avatar: currentUser.photoURL || ''
    };

    // If socket is already set in state, emit join-room
    if (socket) {
      socket.emit('join-room', joinData);
    }

    let interval;
    const checkSocket = () => {
      if (window.socket && window.socket !== socket) {
        setSocket(window.socket);
        window.socket.emit('join-room', joinData);
        if (interval) {
          clearInterval(interval);
        }
      }
    };

    if (!window.socket) {
      interval = setInterval(checkSocket, 500);
    } else {
      checkSocket();
    }

    const currentSocket = window.socket || socket;
    const handleConnect = () => {
      currentSocket.emit('join-room', joinData);
    };

    if (currentSocket) {
      currentSocket.on('connect', handleConnect);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (currentSocket) {
        currentSocket.off('connect', handleConnect);
      }
    };
  }, [roomId, currentUser, socket]);

  const [output, setOutput] = useState({
    stdout: null,
    stderr: null,
    compile_output: null,
    status: null,
    time: null,
    memory: null,
    isRunning: false
  });

  async function handleRun() {
    setOutput(prev => ({ ...prev, isRunning: true, stdout: null, stderr: null, compile_output: null, status: null, time: null, memory: null }));

    const currentCode = editorRef.current ? editorRef.current.getValue() : code;
    
    let runLang = language;
    if (activeFile && activeFile.name) {
      const ext = activeFile.name.split('.').pop()?.toLowerCase() || '';
      runLang = extensionToLanguage(ext) || language;
    }

    const result = await executeCode(currentCode, runLang, roomId);

    setOutput({
      stdout: result.stdout,
      stderr: result.stderr,
      compile_output: result.compile_output,
      status: result.status,
      time: result.time,
      memory: result.memory,
      isRunning: false
    });
  }

  function handleClearConsole() {
    setOutput({
      stdout: null,
      stderr: null,
      compile_output: null,
      status: null,
      time: null,
      memory: null,
      isRunning: false
    });
  }

  // Handle file selection from FileExplorer
  const handleFileSelect = useCallback((fileInfo) => {
    setActiveFile(fileInfo);
    setLanguage(fileInfo.language);

    // Add to open tabs if not already open
    setOpenTabs(prev => {
      const exists = prev.find(t => t.path === fileInfo.path);
      if (!exists) {
        return [...prev, { path: fileInfo.path, name: fileInfo.name, language: fileInfo.language }];
      }
      return prev;
    });
  }, []);

  // Handle shared file auto-opening via URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const openFilePath = params.get('openFile');
    if (openFilePath && roomId) {
      // Clear parameter from URL so it doesn't trigger repeatedly
      const cleanUrl = window.location.pathname + `?room=${roomId}`;
      window.history.replaceState({}, document.title, cleanUrl);

      // Fetch file content
      const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
      fetch(`${API_BASE}/api/workspace/file?roomId=${roomId}&path=${encodeURIComponent(openFilePath)}`)
        .then(res => res.json())
        .then(data => {
          const fileName = openFilePath.split('/').pop();
          const ext = fileName.split('.').pop()?.toLowerCase() || '';
          const lang = extensionToLanguage(ext);

          handleFileSelect({
            path: openFilePath,
            name: fileName,
            content: data.content,
            language: lang,
            size: data.size
          });
        })
        .catch(err => console.error('Error loading shared file:', err));
    }
  }, [roomId, handleFileSelect]);

  // Handle tab close
  const handleCloseTab = useCallback((tabPath) => {
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.path !== tabPath);
      // If closing active tab, switch to the last remaining tab
      if (activeFile?.path === tabPath && newTabs.length > 0) {
        const lastTab = newTabs[newTabs.length - 1];
        // We'd need to re-fetch content here, but for now just clear
        setActiveFile(null);
      } else if (newTabs.length === 0) {
        setActiveFile(null);
      }
      return newTabs;
    });
  }, [activeFile]);

  // Handle tab click (switch to file)
  const handleTabClick = useCallback((tab) => {
    // Re-fetch file content when switching tabs
    const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    fetch(`${API_BASE}/api/workspace/file?roomId=${roomId}&path=${encodeURIComponent(tab.path)}`)
      .then(res => res.json())
      .then(data => {
        setActiveFile({
          path: tab.path,
          name: tab.name,
          content: data.content,
          language: tab.language
        });
        setLanguage(tab.language);
      })
      .catch(err => console.error('Error loading tab content:', err));
  }, [roomId]);

  return (
    <div className="h-100 d-flex flex-column" style={{ margin: '-24px', padding: '12px', backgroundColor: 'var(--bg-dark)' }}>
      <Group direction="horizontal" className="h-100">
        {/* Left Pane: Tabs Switcher (Files, AI, Git, GitHub) */}
        <Panel defaultSize={25} minSize={15} collapsible={true}>
          <div className="workspace-pane d-flex flex-row h-100 p-0" style={{ overflow: 'hidden' }}>
            {/* Activity Bar */}
            <div 
              className="d-flex flex-column align-items-center py-3 gap-3 border-end" 
              style={{ 
                width: '48px', 
                backgroundColor: 'rgba(255,255,255,0.02)', 
                borderColor: 'var(--border-subtle)',
                flexShrink: 0
              }}
            >
              <OverlayTrigger
                placement="right"
                overlay={<Tooltip>File Explorer</Tooltip>}
              >
                <button 
                  onClick={() => setLeftTab('files')}
                  className="btn btn-link p-2 text-decoration-none border-0 rounded-3 d-flex align-items-center justify-content-center"
                  style={{ 
                    color: leftTab === 'files' ? 'var(--accent)' : 'var(--text-muted)',
                    backgroundColor: leftTab === 'files' ? 'rgba(0, 210, 255, 0.1)' : 'transparent',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                >
                  <FolderOpen size={20} />
                </button>
              </OverlayTrigger>

              <OverlayTrigger
                placement="right"
                overlay={<Tooltip>AI Assistant</Tooltip>}
              >
                <button 
                  onClick={() => setLeftTab('ai')}
                  className="btn btn-link p-2 text-decoration-none border-0 rounded-3 d-flex align-items-center justify-content-center"
                  style={{ 
                    color: leftTab === 'ai' ? 'var(--accent)' : 'var(--text-muted)',
                    backgroundColor: leftTab === 'ai' ? 'rgba(0, 210, 255, 0.1)' : 'transparent',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                >
                  <MessageSquare size={20} />
                </button>
              </OverlayTrigger>

              <OverlayTrigger
                placement="right"
                overlay={<Tooltip>Source Control (Git)</Tooltip>}
              >
                <button 
                  onClick={() => setLeftTab('git')}
                  className="btn btn-link p-2 text-decoration-none border-0 rounded-3 d-flex align-items-center justify-content-center"
                  style={{ 
                    color: leftTab === 'git' ? 'var(--accent)' : 'var(--text-muted)',
                    backgroundColor: leftTab === 'git' ? 'rgba(0, 210, 255, 0.1)' : 'transparent',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                >
                  <GitBranch size={20} />
                </button>
              </OverlayTrigger>

              <OverlayTrigger
                placement="right"
                overlay={<Tooltip>GitHub Explorer</Tooltip>}
              >
                <button 
                  onClick={() => setLeftTab('github')}
                  className="btn btn-link p-2 text-decoration-none border-0 rounded-3 d-flex align-items-center justify-content-center"
                  style={{ 
                    color: leftTab === 'github' ? 'var(--accent)' : 'var(--text-muted)',
                    backgroundColor: leftTab === 'github' ? 'rgba(0, 210, 255, 0.1)' : 'transparent',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                >
                  <Github size={20} />
                </button>
              </OverlayTrigger>
            </div>

            {/* Tab Panel Content */}
            <div className="flex-grow-1 h-100 overflow-auto" style={{ backgroundColor: 'var(--bg-card)' }}>
              {leftTab === 'files' && (
                <FileExplorer 
                  roomId={roomId}
                  onFileSelect={handleFileSelect}
                  activeFile={activeFile?.path}
                  socket={socket}
                />
              )}
              {leftTab === 'ai' && (
                <AIAssistantPane editorRef={editorRef} language={language} roomId={roomId} />
              )}

              {leftTab === 'git' && (
                <GitPanel editorRef={editorRef} roomId={roomId} />
              )}
              {leftTab === 'github' && (
                <GithubReposPanel roomId={roomId} />
              )}
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        {/* Center Pane: Code Editor with Tab Bar */}
        <Panel defaultSize={50} minSize={30}>
          <div className="workspace-pane d-flex flex-column h-100 p-0" style={{ overflow: 'hidden' }}>
            {/* Tab Bar for open files */}
            {openTabs.length > 0 && (
              <div className="editor-tab-bar">
                {openTabs.map(tab => (
                  <div 
                    key={tab.path}
                    className={`editor-tab ${activeFile?.path === tab.path ? 'editor-tab-active' : ''}`}
                    onClick={() => handleTabClick(tab)}
                  >
                    <span>{tab.name}</span>
                    <button 
                      className="editor-tab-close"
                      onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.path); }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Editor */}
            <div className="flex-grow-1" style={{ minHeight: 0 }}>
              <CodeEditorPane 
                editorRef={editorRef}
                language={language} 
                setLanguage={setLanguage}
                onRun={handleRun}
                isRunning={output.isRunning}
                roomId={roomId}
                setRoomId={setRoomId}
                activeFile={activeFile}
                socket={socket}
                onFileSelect={handleFileSelect}
              />
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        {/* Right Pane: Preview / Output */}
        <Panel defaultSize={25} minSize={15} collapsible={true}>
          <div className="workspace-pane d-flex flex-column h-100 p-0" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
            {/* Header Tabs */}
            <div className="workspace-pane-header px-2 d-flex justify-content-between align-items-center" style={{ borderBottom: '1px solid var(--border-subtle)', height: '40px', flexShrink: 0 }}>
              <div className="d-flex gap-2 h-100">
                <button
                  onClick={() => setRightTab('console')}
                  className="btn btn-link p-0 px-2 text-decoration-none border-0 d-flex align-items-center gap-1 h-100"
                  style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: rightTab === 'console' ? 'var(--accent)' : 'var(--text-muted)',
                    borderBottom: rightTab === 'console' ? '2px solid var(--accent)' : '2px solid transparent',
                    borderRadius: '0',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                >
                  <Terminal size={12} />
                  <span>Console Output</span>
                </button>
                <button
                  onClick={() => setRightTab('preview')}
                  className="btn btn-link p-0 px-2 text-decoration-none border-0 d-flex align-items-center gap-1 h-100"
                  style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: rightTab === 'preview' ? 'var(--accent)' : 'var(--text-muted)',
                    borderBottom: rightTab === 'preview' ? '2px solid var(--accent)' : '2px solid transparent',
                    borderRadius: '0',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                >
                  <Globe size={12} />
                  <span>Live App Preview</span>
                </button>
              </div>

              {rightTab === 'preview' && (
                <button
                  onClick={handleRefreshIframe}
                  className="btn btn-link p-1 text-muted border-0 d-flex align-items-center justify-content-center"
                  style={{ outline: 'none', boxShadow: 'none' }}
                  title="Reload Preview"
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </div>

            {/* Pane Content */}
            <div className="flex-grow-1" style={{ minHeight: 0 }}>
              {rightTab === 'console' ? (
                <PreviewPane output={output} onClear={handleClearConsole} />
              ) : (
                <div className="h-100 d-flex flex-column" style={{ backgroundColor: '#0f172a' }}>
                  {/* Address bar mockup */}
                  <div className="d-flex align-items-center px-2 py-1 gap-2" style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '11px', flexShrink: 0 }}>
                    <div className="d-flex gap-1" style={{ width: '40px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444' }}></span>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b' }}></span>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }}></span>
                    </div>
                    <div className="flex-grow-1 text-center bg-dark text-muted py-0.5 rounded px-2" style={{ border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'monospace', fontSize: '9px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {PREVIEW_BASE_URL}/?room={roomId}
                    </div>
                  </div>
                  
                  {/* Preview iframe */}
                  <iframe
                    ref={iframeRef}
                    src={`${PREVIEW_BASE_URL}/?room=${roomId}`}
                    title="Live App Preview"
                    className="w-100 flex-grow-1 border-0"
                    style={{ backgroundColor: '#ffffff' }}
                  />
                </div>
              )}
            </div>
          </div>
        </Panel>

      </Group>
    </div>
  );
}

function ResizeHandle() {
  return (
    <Separator className="d-flex align-items-center justify-content-center" style={{ width: '8px', cursor: 'col-resize', backgroundColor: 'var(--bg-dark)' }}>
      <div className="rounded-pill d-flex align-items-center justify-content-center" style={{ width: '2px', height: '24px', backgroundColor: 'rgba(255, 255, 255, 0.08)' }}>
        <GripVertical size={10} color="var(--text-muted)" style={{ display: 'none' }} />
      </div>
    </Separator>
  );
}
