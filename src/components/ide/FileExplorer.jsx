/**
 * FileExplorer Component
 * 
 * Displays a hierarchical tree of workspace files.
 * Supports creating, renaming, and deleting files/folders.
 * Integrates with Socket.IO for real-time file tree updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  FolderOpen, Folder, FileCode, FileText, File, 
  ChevronDown, ChevronRight, Plus, RefreshCw, 
  Trash2, Edit3, FolderPlus, FilePlus, Loader,
  Image, Database, Settings, Package, Hash
} from 'lucide-react';
import { Button, Form, InputGroup, OverlayTrigger, Tooltip } from 'react-bootstrap';

const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

// File icon mapper based on extension
function getFileIcon(name, extension) {
  const ext = extension || name.split('.').pop()?.toLowerCase() || '';
  const iconProps = { size: 14, style: { flexShrink: 0 } };

  switch (ext) {
    case 'js': case 'jsx': case 'ts': case 'tsx':
      return <FileCode {...iconProps} color="#f7df1e" />;
    case 'html': case 'htm':
      return <FileCode {...iconProps} color="#e34f26" />;
    case 'css': case 'scss': case 'less':
      return <FileCode {...iconProps} color="#1572b6" />;
    case 'py':
      return <FileCode {...iconProps} color="#3572a5" />;
    case 'json': case 'yaml': case 'yml':
      return <Settings {...iconProps} color="#8bc34a" />;
    case 'md': case 'txt':
      return <FileText {...iconProps} color="#7aa2f7" />;
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp':
      return <Image {...iconProps} color="#c678dd" />;
    case 'sql': case 'db':
      return <Database {...iconProps} color="#e06c75" />;
    case 'lock':
      return <Package {...iconProps} color="#6c6c6c" />;
    case 'env':
      return <Hash {...iconProps} color="#f59e0b" />;
    case 'go':
      return <FileCode {...iconProps} color="#00add8" />;
    case 'rs':
      return <FileCode {...iconProps} color="#dea584" />;
    case 'java': case 'class':
      return <FileCode {...iconProps} color="#ed8b00" />;
    case 'c': case 'cpp': case 'h':
      return <FileCode {...iconProps} color="#649ad2" />;
    case 'rb':
      return <FileCode {...iconProps} color="#cc342d" />;
    case 'php':
      return <FileCode {...iconProps} color="#8892be" />;
    case 'sh': case 'bash':
      return <FileCode {...iconProps} color="#89e051" />;
    default:
      return <File {...iconProps} color="#6c6c6c" />;
  }
}

// Language mapper from extension
export function extensionToLanguage(ext) {
  const map = {
    'js': 'javascript', 'jsx': 'javascript',
    'ts': 'typescript', 'tsx': 'typescript',
    'html': 'html', 'htm': 'html',
    'css': 'css', 'scss': 'css', 'less': 'css',
    'py': 'python',
    'cpp': 'cpp', 'c': 'c', 'h': 'c',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'php': 'php',
    'rb': 'ruby',
    'cs': 'csharp',
    'swift': 'swift',
    'sh': 'bash', 'bash': 'bash',
    'sql': 'sql',
    'json': 'json',
    'md': 'markdown',
    'yaml': 'yaml', 'yml': 'yaml',
    'xml': 'xml',
    'env': 'plaintext',
    'txt': 'plaintext',
    'gitignore': 'plaintext',
  };
  return map[ext?.toLowerCase()] || 'plaintext';
}

// Format file size
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// TreeNode Component
function TreeNode({ node, depth, activeFile, onFileClick, onDelete, onRename, roomId, isReadOnly }) {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const inputRef = useRef(null);
  const isActive = activeFile === node.path;

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue !== node.name) {
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
      const newPath = parentPath ? `${parentPath}/${renameValue.trim()}` : renameValue.trim();
      onRename(node.path, newPath);
    }
    setIsRenaming(false);
  };

  if (node.type === 'directory') {
    return (
      <div>
        <div 
          className="file-tree-item"
          style={{ 
            paddingLeft: `${depth * 16 + 8}px`,
            cursor: 'pointer'
          }}
          onClick={() => setIsOpen(!isOpen)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="d-flex align-items-center" style={{ color: '#e5c07b' }}>
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {isOpen 
            ? <FolderOpen size={14} color="#e5c07b" style={{ flexShrink: 0 }} />
            : <Folder size={14} color="#e5c07b" style={{ flexShrink: 0 }} />
          }
          {isRenaming ? (
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') { setIsRenaming(false); setRenameValue(node.name); }
              }}
              className="file-tree-rename-input"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="file-tree-name">{node.name}</span>
          )}
          {!isReadOnly && (
            <div className="file-tree-actions">
              <button onClick={(e) => { e.stopPropagation(); setIsRenaming(true); }} title="Rename">
                <Edit3 size={11} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(node.path, true); }} title="Delete">
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </div>
        {isOpen && node.children && node.children.map(child => (
          <TreeNode 
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            onFileClick={onFileClick}
            onDelete={onDelete}
            onRename={onRename}
            roomId={roomId}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>
    );
  }

  // File node
  return (
    <div
      className={`file-tree-item ${isActive ? 'file-tree-item-active' : ''}`}
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
      onClick={() => onFileClick(node.path, node.name)}
      title={`${node.path} (${formatSize(node.size || 0)})`}
    >
      {getFileIcon(node.name, node.extension)}
      {isRenaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
            if (e.key === 'Escape') { setIsRenaming(false); setRenameValue(node.name); }
          }}
          className="file-tree-rename-input"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="file-tree-name">{node.name}</span>
      )}
      {!isReadOnly && (
        <div className="file-tree-actions">
          <button onClick={(e) => { e.stopPropagation(); setIsRenaming(true); }} title="Rename">
            <Edit3 size={11} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(node.path, false); }} title="Delete">
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({ roomId, onFileSelect, activeFile, isReadOnly = false, socket }) {
  const { currentUser } = useAuth();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [creating, setCreating] = useState(false);
  const newItemRef = useRef(null);

  // Fetch file tree from server
  const fetchFiles = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/workspace/files?roomId=${roomId}`);
      if (!response.ok) throw new Error('Failed to load files');
      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error(`Server returned invalid response (Error ${response.status})`);
      }
      setFiles(data.files || []);
    } catch (err) {
      console.error('[FileExplorer] Error fetching files:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Real-time file explorer sync via Socket.IO
  useEffect(() => {
    if (!socket) return;

    const handleFileTreeChange = () => {
      fetchFiles();
    };

    socket.on('file-tree-changed', handleFileTreeChange);

    return () => {
      socket.off('file-tree-changed', handleFileTreeChange);
    };
  }, [socket, fetchFiles]);

  useEffect(() => {
    if ((showNewFile || showNewFolder) && newItemRef.current) {
      newItemRef.current.focus();
    }
  }, [showNewFile, showNewFolder]);

  // Handle file click
  const handleFileClick = useCallback(async (filePath, fileName) => {
    try {
      const response = await fetch(`${API_BASE}/api/workspace/file?roomId=${roomId}&path=${encodeURIComponent(filePath)}`);
      if (!response.ok) throw new Error('Failed to read file');
      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error(`Server returned invalid response (Error ${response.status})`);
      }

      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      const language = extensionToLanguage(ext);

      if (onFileSelect) {
        onFileSelect({
          path: filePath,
          name: fileName,
          content: data.content,
          language,
          size: data.size
        });
      }
    } catch (err) {
      console.error('[FileExplorer] Error reading file:', err);
    }
  }, [roomId, onFileSelect]);

  // Create new file
  const handleCreateFile = async () => {
    const filePath = newItemName.trim();
    if (!filePath) return;
    setCreating(true);
    try {
      const response = await fetch(`${API_BASE}/api/workspace/create-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, path: filePath, content: '' })
      });

      if (!response.ok) {
        let errMsg = 'Failed to create file';
        try {
          const data = await response.json();
          errMsg = data.error || errMsg;
        } catch (e) {
          errMsg = `Error ${response.status}: ${response.statusText || 'Unexpected response structure'}`;
        }
        throw new Error(errMsg);
      }

      setNewItemName('');
      setShowNewFile(false);
      await fetchFiles();

      if (socket) {
        socket.emit('file-created', { roomId, filePath });
      }

      // Auto-open the new file
      handleFileClick(filePath, filePath.split('/').pop());
    } catch (err) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Create new folder
  const handleCreateFolder = async () => {
    const folderPath = newItemName.trim();
    if (!folderPath) return;
    setCreating(true);
    try {
      const response = await fetch(`${API_BASE}/api/workspace/create-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, path: folderPath })
      });

      if (!response.ok) {
        let errMsg = 'Failed to create folder';
        try {
          const data = await response.json();
          errMsg = data.error || errMsg;
        } catch (e) {
          errMsg = `Error ${response.status}: ${response.statusText || 'Unexpected response structure'}`;
        }
        throw new Error(errMsg);
      }

      setNewItemName('');
      setShowNewFolder(false);
      await fetchFiles();

      if (socket) {
        socket.emit('file-created', { roomId, filePath: folderPath });
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Delete file/folder
  const handleDelete = async (path, isDirectory) => {
    const type = isDirectory ? 'folder' : 'file';
    if (!window.confirm(`Delete ${type} "${path}"?`)) return;

    try {
      const response = await fetch(`${API_BASE}/api/workspace/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, path })
      });

      if (!response.ok) throw new Error(`Failed to delete ${type}`);
      await fetchFiles();

      if (socket) {
        socket.emit('file-deleted', { roomId, filePath: path });
      }
    } catch (err) {
      alert(err.message);
    }
  };

  // Rename file/folder
  const handleRename = async (oldPath, newPath) => {
    try {
      const response = await fetch(`${API_BASE}/api/workspace/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, oldPath, newPath })
      });

      if (!response.ok) throw new Error('Failed to rename');
      await fetchFiles();

      if (socket) {
        socket.emit('file-renamed', { roomId, oldPath, newPath });
      }
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="file-explorer h-100 d-flex flex-column">
      {/* Header */}
      <div className="workspace-pane-header px-3" style={{ minHeight: '40px' }}>
        <div className="workspace-pane-title">
          <FolderOpen size={14} color="#e5c07b" />
          <span className="fw-semibold" style={{ fontSize: '12px' }}>EXPLORER</span>
          <span className="text-muted" style={{ fontSize: '10px' }}>#{roomId}</span>
        </div>
        <div className="d-flex align-items-center gap-1">
          {!isReadOnly && (
            <>
              <OverlayTrigger placement="bottom" overlay={<Tooltip>New File</Tooltip>}>
                <button 
                  className="file-explorer-action-btn"
                  onClick={() => { setShowNewFile(true); setShowNewFolder(false); setNewItemName(''); }}
                >
                  <FilePlus size={14} />
                </button>
              </OverlayTrigger>
              <OverlayTrigger placement="bottom" overlay={<Tooltip>New Folder</Tooltip>}>
                <button 
                  className="file-explorer-action-btn"
                  onClick={() => { setShowNewFolder(true); setShowNewFile(false); setNewItemName(''); }}
                >
                  <FolderPlus size={14} />
                </button>
              </OverlayTrigger>
            </>
          )}
          <OverlayTrigger placement="bottom" overlay={<Tooltip>Refresh</Tooltip>}>
            <button 
              className="file-explorer-action-btn"
              onClick={fetchFiles}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'spinner-rotate' : ''} />
            </button>
          </OverlayTrigger>
        </div>
      </div>

      {/* New File/Folder Input */}
      {(showNewFile || showNewFolder) && (
        <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <InputGroup size="sm">
            <InputGroup.Text 
              className="bg-transparent border-secondary text-muted" 
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              {showNewFile ? <FilePlus size={12} /> : <FolderPlus size={12} />}
            </InputGroup.Text>
            <Form.Control
              ref={newItemRef}
              type="text"
              placeholder={showNewFile ? 'filename.ext' : 'folder-name'}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') showNewFile ? handleCreateFile() : handleCreateFolder();
                if (e.key === 'Escape') { setShowNewFile(false); setShowNewFolder(false); }
              }}
              style={{ fontSize: '12px', padding: '3px 8px' }}
              disabled={creating}
            />
            <Button 
              variant="success" 
              size="sm"
              onClick={showNewFile ? handleCreateFile : handleCreateFolder}
              disabled={creating || !newItemName.trim()}
              style={{ fontSize: '11px', padding: '2px 8px' }}
            >
              {creating ? <Loader size={12} className="spinner-rotate" /> : 'Create'}
            </Button>
          </InputGroup>
        </div>
      )}

      {/* File Tree */}
      <div className="flex-grow-1 overflow-auto custom-scrollbar" style={{ padding: '4px 0' }}>
        {loading ? (
          <div className="d-flex align-items-center justify-content-center py-5 text-muted">
            <Loader size={16} className="spinner-rotate me-2" />
            <span style={{ fontSize: '12px' }}>Loading workspace...</span>
          </div>
        ) : error ? (
          <div className="text-center py-5 px-3">
            <div className="text-danger small mb-2">{error}</div>
            <Button variant="outline-secondary" size="sm" onClick={fetchFiles} style={{ fontSize: '11px' }}>
              Retry
            </Button>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-5 px-3">
            <FolderOpen size={28} className="text-muted mb-2" />
            <div className="text-muted small">Workspace is empty</div>
            <div className="text-muted" style={{ fontSize: '10px' }}>
              Clone a repository or create files to get started
            </div>
          </div>
        ) : (
          files.map(node => (
            <TreeNode 
              key={node.path}
              node={node}
              depth={0}
              activeFile={activeFile}
              onFileClick={handleFileClick}
              onDelete={handleDelete}
              onRename={handleRename}
              roomId={roomId}
              isReadOnly={isReadOnly}
            />
          ))
        )}
      </div>

      {/* Footer: file count */}
      {files.length > 0 && (
        <div className="px-3 py-1" style={{ borderTop: '1px solid var(--border-subtle)', fontSize: '10px', color: 'var(--text-muted)' }}>
          {countFiles(files)} files
        </div>
      )}
    </div>
  );
}

function countFiles(nodes) {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file') count++;
    if (node.children) count += countFiles(node.children);
  }
  return count;
}
