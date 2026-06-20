/**
 * CollaborativePresencePanel
 * 
 * A rich sidebar panel upgraded to a tabbed interface:
 * 1. Collab: Online/offline members and active file awareness.
 * 2. Chat: Integrated room chat with autocomplete mentions (@name), formatted snippets,
 *           and clickable file sharing badges that open instantly in the Monaco editor.
 * 3. Timeline: Unified stream of repository commits/pushes/switches and task edits.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Users, Eye, Edit2, Clock, FileCode2, Wifi, WifiOff, Keyboard, 
  MessageSquare, History, Send, Paperclip, FileText, X, ExternalLink 
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { extensionToLanguage } from './FileExplorer';
import { Button, Form, Badge, ListGroup } from 'react-bootstrap';
import { useTheme } from '../../contexts/ThemeContext';

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#6366f1'
];

const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

function getUserColor(uid) {
  if (!uid) return COLORS[0];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getStatusIcon(status) {
  switch (status) {
    case 'typing':
      return <Keyboard size={10} className="collab-status-icon collab-status-typing" />;
    case 'editing':
      return <Edit2 size={10} className="collab-status-icon collab-status-editing" />;
    case 'viewing':
      return <Eye size={10} className="collab-status-icon collab-status-viewing" />;
    default:
      return <Clock size={10} className="collab-status-icon collab-status-idle" />;
  }
}

function getStatusLabel(status, fileName) {
  switch (status) {
    case 'typing':
      return <span className="collab-status-text typing-pulse">typing in <strong>{fileName || 'a file'}</strong></span>;
    case 'editing':
      return <span className="collab-status-text">editing <strong>{fileName || 'a file'}</strong></span>;
    case 'viewing':
      return <span className="collab-status-text">viewing <strong>{fileName || 'a file'}</strong></span>;
    default:
      return <span className="collab-status-text text-muted">idle</span>;
  }
}

function getRelativeTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CollaborativePresencePanel({
  awarenessUsers = [],
  membersList = [],
  currentUid,
  roomId,
  isCollapsed = false,
  onFileSelect
}) {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('collab'); // 'collab' | 'chat' | 'timeline'
  
  // Chat States
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [fileShare, setFileShare] = useState(null);
  
  // Mentions Autocomplete
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionIndex, setMentionIndex] = useState(-1);
  const inputRef = useRef(null);

  // File Sharing selection overlay
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);

  // Timeline States
  const [activities, setActivities] = useState([]);

  const chatEndRef = useRef(null);

  // 1. Subscribe to Chat messages in this room
  useEffect(() => {
    if (!roomId) return;
    const q = query(
      collection(db, 'Messages'),
      where('roomId', '==', roomId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => {
        const timeA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp || 0);
        const timeB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp || 0);
        return timeA - timeB;
      });
      setChatMessages(list);
    });
    return () => unsubscribe();
  }, [roomId]);

  // 2. Subscribe to Timeline (GitActivity) logs in this room
  useEffect(() => {
    if (!roomId) return;
    const q = query(
      collection(db, 'GitActivity'),
      where('workspaceId', '==', roomId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      list.sort((a, b) => {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return timeB - timeA; // Descending for timeline
      });
      setActivities(list);
    });
    return () => unsubscribe();
  }, [roomId]);

  // Scroll Chat to bottom
  const scrollToChatBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToChatBottom();
    }
  }, [activeTab, chatMessages, scrollToChatBottom]);

  // Fetch workspace files for sharing
  const loadFiles = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/workspace/files?roomId=${roomId}`);
      if (response.ok) {
        const data = await response.json();
        const list = [];
        const traverse = (nodes) => {
          nodes.forEach(node => {
            if (node.type === 'file') {
              list.push(node);
            }
            if (node.children) {
              traverse(node.children);
            }
          });
        };
        traverse(data.files || []);
        setWorkspaceFiles(list);
      }
    } catch (e) {
      console.error('Error loading files in panel:', e);
    }
  };

  useEffect(() => {
    if (showFileSelector) {
      loadFiles();
    }
  }, [showFileSelector]);

  // Handle clicking on a shared file link
  const handleFileShareClick = async (sharedFile) => {
    if (!onFileSelect || !sharedFile || !sharedFile.path) return;
    try {
      const response = await fetch(`${API_BASE}/api/workspace/file?roomId=${roomId}&path=${encodeURIComponent(sharedFile.path)}`);
      if (!response.ok) throw new Error('Failed to read file');
      const data = await response.json();

      const ext = sharedFile.name.split('.').pop()?.toLowerCase() || '';
      const language = extensionToLanguage(ext);

      onFileSelect({
        path: sharedFile.path,
        name: sharedFile.name,
        content: data.content,
        language,
        size: data.size
      });
    } catch (e) {
      console.error('Error loading file share:', e);
    }
  };

  // Autocomplete Mentions
  const handleInputChange = (e) => {
    const val = e.target.value;
    setNewMessage(val);

    const selectionStart = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, selectionStart);
    const lastAtIdx = textBeforeCursor.lastIndexOf('@');

    if (lastAtIdx !== -1 && !/\s/.test(textBeforeCursor.slice(lastAtIdx + 1))) {
      const search = textBeforeCursor.slice(lastAtIdx + 1).toLowerCase();
      setMentionSearch(search);
      setMentionIndex(lastAtIdx);
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }
  };

  const selectMention = (username) => {
    const beforeMention = newMessage.slice(0, mentionIndex);
    const afterMention = newMessage.slice(mentionIndex + mentionSearch.length + 1);
    const newText = beforeMention + `@${username} ` + afterMention;
    setNewMessage(newText);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const filteredMembers = membersList.filter(member => {
    const name = member.userName || member.userEmail?.split('@')[0] || '';
    return name.toLowerCase().includes(mentionSearch);
  });

  // Parse message text for snippets
  const formatMessageText = (text) => {
    if (!text) return [];
    const parts = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        parts.push({ type: 'text', content: textBefore });
      }
      parts.push({ type: 'code', language: match[1] || 'plaintext', content: match[2] });
      lastIndex = regex.lastIndex;
    }

    const textAfter = text.slice(lastIndex);
    if (textAfter) {
      parts.push({ type: 'text', content: textAfter });
    }

    if (parts.length === 0) {
      return [{ type: 'text', content: text }];
    }
    return parts;
  };

  // Send message
  const handleSend = async (e) => {
    e.preventDefault();
    if ((!newMessage.trim() && !fileShare) || sending) return;

    setSending(true);
    try {
      const messageText = newMessage.trim();
      const mentions = [];
      const mentionRegex = /@(\w+)/g;
      let match;
      while ((match = mentionRegex.exec(messageText)) !== null) {
        mentions.push(match[1]);
      }

      const messageDoc = {
        text: messageText,
        senderUid: currentUser.uid,
        senderName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
        senderEmail: currentUser.email,
        timestamp: serverTimestamp(),
        roomId: roomId,
        fileShare: fileShare || null
      };

      const docRef = await addDoc(collection(db, 'Messages'), messageDoc);

      if (window.socket) {
        window.socket.emit('chat-message', {
          roomId,
          message: {
            id: docRef.id,
            ...messageDoc,
            timestamp: Date.now()
          }
        });

        if (mentions.length > 0) {
          window.socket.emit('send-notification', {
            roomId,
            notification: {
              message: `${messageDoc.senderName} mentioned you in #${roomId}`,
              type: 'mention',
              targetUsernames: mentions,
              senderName: messageDoc.senderName,
              timestamp: Date.now()
            }
          });
        }
      }

      setNewMessage('');
      setFileShare(null);
      setShowMentions(false);
    } catch (e) {
      console.error('Error sending message:', e);
    } finally {
      setSending(false);
    }
  };

  // Build file awareness map: { filePath: [users editing it] }
  const fileAwareness = useMemo(() => {
    const map = {};
    awarenessUsers.forEach(user => {
      if (user.uid === currentUid) return;
      if (user.activeFile) {
        const fileName = user.activeFile.split('/').pop();
        if (!map[fileName]) map[fileName] = [];
        map[fileName].push(user);
      }
    });
    return map;
  }, [awarenessUsers, currentUid]);

  // Separate online (from awareness) vs offline (from members list)
  const { onlineUsers, offlineMembers, typingUsers } = useMemo(() => {
    const onlineUids = new Set(awarenessUsers.map(u => u.uid));
    
    const online = awarenessUsers.map(u => ({
      ...u,
      color: getUserColor(u.uid),
      isSelf: u.uid === currentUid,
      fileName: u.activeFile ? u.activeFile.split('/').pop() : null,
    }));

    const offline = membersList
      .filter(m => !onlineUids.has(m.userId))
      .map(m => ({
        uid: m.userId,
        name: m.userName || m.userEmail?.split('@')[0] || 'User',
        role: m.role,
        color: getUserColor(m.userId),
        isSelf: m.userId === currentUid,
      }));

    const typing = online.filter(u => u.status === 'typing' && !u.isSelf);

    return { onlineUsers: online, offlineMembers: offline, typingUsers: typing };
  }, [awarenessUsers, membersList, currentUid]);

  if (isCollapsed) {
    return (
      <div className="collab-panel-collapsed">
        <div className="collab-panel-collapsed-icon">
          <Users size={14} />
          <span className="collab-panel-badge">{onlineUsers.length}</span>
        </div>
      </div>
    );
  }

  const getTimelineBadgeColor = (actionType) => {
    switch (actionType) {
      case 'push': return 'success';
      case 'commit': return 'primary';
      case 'switch': return 'warning';
      case 'task-create': return 'info';
      case 'task-assign': return 'secondary';
      case 'task-status': return 'danger';
      default: return theme === 'dark' ? 'dark' : 'light';
    }
  };

  return (
    <div className="collab-presence-panel d-flex flex-column h-100 border-start" style={{ width: '320px', backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
      {/* Tab Header Selector */}
      <div className="d-flex border-bottom" style={{ borderColor: 'var(--border-subtle)', height: '42px', backgroundColor: 'rgba(255,255,255,0.01)' }}>
        <button 
          onClick={() => setActiveTab('collab')}
          className="flex-grow-1 border-0 bg-transparent text-center py-2 d-flex align-items-center justify-content-center gap-1"
          style={{ 
            fontSize: '12px', 
            color: activeTab === 'collab' ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: activeTab === 'collab' ? '700' : '500',
            borderBottom: activeTab === 'collab' ? '2px solid var(--accent)' : 'none',
            outline: 'none'
          }}
        >
          <Users size={13} />
          <span>People ({onlineUsers.length})</span>
        </button>
        <button 
          onClick={() => setActiveTab('chat')}
          className="flex-grow-1 border-0 bg-transparent text-center py-2 d-flex align-items-center justify-content-center gap-1"
          style={{ 
            fontSize: '12px', 
            color: activeTab === 'chat' ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: activeTab === 'chat' ? '700' : '500',
            borderBottom: activeTab === 'chat' ? '2px solid var(--accent)' : 'none',
            outline: 'none'
          }}
        >
          <MessageSquare size={13} />
          <span>Chat</span>
        </button>
        <button 
          onClick={() => setActiveTab('timeline')}
          className="flex-grow-1 border-0 bg-transparent text-center py-2 d-flex align-items-center justify-content-center gap-1"
          style={{ 
            fontSize: '12px', 
            color: activeTab === 'timeline' ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: activeTab === 'timeline' ? '700' : '500',
            borderBottom: activeTab === 'timeline' ? '2px solid var(--accent)' : 'none',
            outline: 'none'
          }}
        >
          <History size={13} />
          <span>Timeline</span>
        </button>
      </div>

      {/* Panel Views Content */}
      <div className="flex-grow-1 overflow-auto p-3" style={{ minHeight: 0 }}>
        
        {/* COLLAB TAB */}
        {activeTab === 'collab' && (
          <div className="collab-tab-content">
            {/* Typing Indicator Banner */}
            {typingUsers.length > 0 && (
              <div className="collab-typing-banner mb-3">
                <div className="collab-typing-dots">
                  <span /><span /><span />
                </div>
                <span className="collab-typing-text">
                  {typingUsers.length === 1
                    ? `${typingUsers[0].name} is typing...`
                    : `${typingUsers[0].name} and ${typingUsers.length - 1} others typing...`
                  }
                </span>
              </div>
            )}

            {/* Online Users */}
            <div className="collab-panel-section mb-4">
              <div className="collab-section-label">
                <Wifi size={10} />
                Online
              </div>
              <div className="collab-user-list">
                {onlineUsers.map((user) => (
                  <div
                    key={user.uid || user.clientId}
                    className={`collab-user-card ${user.isSelf ? 'collab-user-self' : ''} ${user.status === 'typing' ? 'collab-user-typing' : ''}`}
                  >
                    <div className="collab-user-avatar-wrap">
                      <div
                        className="collab-user-avatar"
                        style={{ backgroundColor: user.color }}
                      >
                        {user.name?.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={`collab-user-status-dot ${user.status === 'typing' || user.status === 'editing' ? 'status-active' : user.status === 'viewing' ? 'status-viewing' : 'status-idle'}`}
                      />
                    </div>

                    <div className="collab-user-info">
                      <div className="collab-user-name-row">
                        <span className="collab-user-name">
                          {user.name}
                          {user.isSelf && <span className="collab-you-tag">you</span>}
                        </span>
                      </div>
                      <div className="collab-user-activity">
                        {getStatusIcon(user.status)}
                        {getStatusLabel(user.status, user.fileName)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* File Awareness */}
            {Object.keys(fileAwareness).length > 0 && (
              <div className="collab-panel-section mb-4">
                <div className="collab-section-label">
                  <FileCode2 size={10} />
                  Active Files
                </div>
                <div className="collab-file-list">
                  {Object.entries(fileAwareness).map(([fileName, users]) => (
                    <div key={fileName} className="collab-file-card">
                      <div className="collab-file-icon">
                        <FileCode2 size={12} />
                      </div>
                      <div className="collab-file-info">
                        <span className="collab-file-name">{fileName}</span>
                        <div className="collab-file-editors">
                          {users.map(u => (
                            <span
                              key={u.uid}
                              className="collab-file-editor-chip"
                              style={{ borderColor: getUserColor(u.uid), color: getUserColor(u.uid) }}
                            >
                              {u.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Offline Members */}
            {offlineMembers.length > 0 && (
              <div className="collab-panel-section">
                <div className="collab-section-label collab-section-offline">
                  <WifiOff size={10} />
                  Offline
                </div>
                <div className="collab-user-list">
                  {offlineMembers.map((user) => (
                    <div key={user.uid} className="collab-user-card collab-user-offline">
                      <div className="collab-user-avatar-wrap">
                        <div
                          className="collab-user-avatar collab-avatar-offline"
                          style={{ backgroundColor: '#555' }}
                        >
                          {user.name?.charAt(0).toUpperCase()}
                        </div>
                      </div>
                      <div className="collab-user-info">
                        <span className="collab-user-name collab-name-offline">{user.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <div className="d-flex flex-column h-100" style={{ position: 'relative' }}>
            {/* Scrollable messages container */}
            <div className="flex-grow-1 overflow-auto pr-1 mb-2" style={{ maxHeight: 'calc(100vh - 240px)', minHeight: 0 }}>
              {chatMessages.length === 0 ? (
                <div className="text-center text-muted py-5">
                  <MessageSquare size={20} className="mb-2 opacity-50" />
                  <div className="small">No messages in room yet.</div>
                </div>
              ) : (
                chatMessages.map(msg => {
                  const isMe = msg.senderUid === currentUser?.uid;
                  return (
                    <div key={msg.id} className={`mb-3 d-flex flex-column ${isMe ? 'align-items-end' : 'align-items-start'}`}>
                      <div className="d-flex align-items-center gap-1 mb-1" style={{ fontSize: '11px' }}>
                        <span className="fw-semibold" style={{ color: isMe ? 'var(--accent)' : '#8b5cf6' }}>{msg.senderName}</span>
                        <span className="text-muted opacity-50">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div 
                        className="rounded p-2 px-3 small" 
                        style={{ 
                          backgroundColor: isMe ? 'var(--accent)' : 'var(--bg-secondary)',
                          color: isMe ? (theme === 'dark' ? '#000000' : '#ffffff') : 'var(--text-primary)',
                          border: isMe ? 'none' : '1px solid var(--border-subtle)',
                          maxWidth: '85%',
                          fontWeight: isMe ? '500' : 'normal',
                          wordBreak: 'break-word'
                        }}
                      >
                        <div>
                          {formatMessageText(msg.text).map((part, index) => {
                            if (part.type === 'code') {
                              return (
                                <pre key={index} className="chat-code-snippet my-1 p-2 rounded theme-bg-secondary theme-text-primary border theme-border font-monospace" style={{ fontSize: '10px', whiteSpace: 'pre-wrap' }}>
                                  <code>{part.content}</code>
                                </pre>
                              );
                            }
                            return <span key={index}>{part.content}</span>;
                          })}
                        </div>
                        {msg.fileShare && (
                          <div className="mt-1">
                            <Badge 
                              bg={theme === 'dark' ? 'dark' : 'light'} 
                              className="file-share-badge d-inline-flex align-items-center gap-1 p-1 text-info"
                              style={{ cursor: 'pointer', fontSize: '9px' }}
                              onClick={() => handleFileShareClick(msg.fileShare)}
                            >
                              <FileText size={10} />
                              <span className="theme-text-primary">{msg.fileShare.name}</span>
                              <ExternalLink size={8} />
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Mentions Autocomplete list */}
            {showMentions && filteredMembers.length > 0 && (
              <ListGroup 
                className="position-absolute shadow-lg border theme-border"
                style={{
                  bottom: '50px',
                  left: '0',
                  right: '0',
                  zIndex: 1050,
                  maxHeight: '120px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '4px'
                }}
              >
                {filteredMembers.map(m => {
                  const name = m.userName || m.userEmail?.split('@')[0] || '';
                  return (
                    <ListGroup.Item
                      key={m.id}
                      action
                      onClick={() => selectMention(name)}
                      className="theme-bg-secondary theme-text-primary border-0 py-1 px-2 small d-flex align-items-center gap-2"
                      style={{ fontSize: '11px' }}
                    >
                      <span>{name}</span>
                    </ListGroup.Item>
                  );
                })}
              </ListGroup>
            )}

            {/* File Sharing selection list overlay */}
            {showFileSelector && (
              <ListGroup 
                className="position-absolute shadow-lg border theme-border"
                style={{
                  bottom: '50px',
                  left: '0',
                  right: '0',
                  zIndex: 1050,
                  maxHeight: '150px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '4px'
                }}
              >
                <ListGroup.Item className="theme-bg-tertiary theme-text-primary border-0 py-1 px-2 small fw-bold d-flex justify-content-between align-items-center">
                  <span>Select file to share:</span>
                  <X size={12} className="cursor-pointer" onClick={() => setShowFileSelector(false)} />
                </ListGroup.Item>
                {workspaceFiles.map((f, i) => (
                  <ListGroup.Item
                    key={i}
                    action
                    onClick={() => {
                      setFileShare({ path: f.path, name: f.name });
                      setShowFileSelector(false);
                    }}
                    className="theme-bg-secondary theme-text-primary border-0 py-1 px-2 small d-flex align-items-center gap-1"
                    style={{ fontSize: '11px' }}
                  >
                    <FileText size={10} className="text-info" />
                    <span className="text-truncate">{f.name}</span>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}

            {/* Selected File Share Preview badge */}
            {fileShare && (
              <div className="d-flex align-items-center justify-content-between theme-bg-secondary border theme-border rounded p-1 mb-1 small" style={{ fontSize: '10px' }}>
                <span className="text-truncate flex-grow-1 text-info d-flex align-items-center gap-1">
                  <FileText size={11} /> {fileShare.name}
                </span>
                <X size={12} className="cursor-pointer text-muted" onClick={() => setFileShare(null)} />
              </div>
            )}

            {/* Message input */}
            <Form onSubmit={handleSend} className="d-flex gap-1">
              <Button 
                variant="outline-secondary"
                size="sm"
                onClick={() => setShowFileSelector(!showFileSelector)}
                className="d-flex align-items-center justify-content-center p-2"
                style={{ outline: 'none', boxShadow: 'none' }}
              >
                <Paperclip size={13} />
              </Button>
              <Form.Control
                ref={inputRef}
                type="text"
                placeholder="Message room..."
                value={newMessage}
                onChange={handleInputChange}
                size="sm"
                className=""
                autoComplete="off"
                disabled={sending}
              />
              <Button 
                type="submit" 
                variant="primary" 
                size="sm"
                disabled={(!newMessage.trim() && !fileShare) || sending}
                style={{ background: 'var(--primary-gradient)', border: 'none' }}
              >
                <Send size={13} />
              </Button>
            </Form>
          </div>
        )}

        {/* TIMELINE TAB */}
        {activeTab === 'timeline' && (
          <div className="timeline-tab-content">
            {activities.length === 0 ? (
              <div className="text-center text-muted py-5">
                <History size={20} className="mb-2 opacity-50" />
                <div className="small">No activity logged yet.</div>
              </div>
            ) : (
              <div className="d-flex flex-column gap-3">
                {activities.map((act) => (
                  <div key={act.id} className="timeline-entry p-2 rounded theme-bg-secondary border theme-border" style={{ fontSize: '11.5px', borderLeft: `3px solid var(--bs-${getTimelineBadgeColor(act.actionType)})` }}>
                    <div className="d-flex align-items-center justify-content-between mb-1">
                      <Badge bg={getTimelineBadgeColor(act.actionType)} style={{ fontSize: '9px', textTransform: 'uppercase' }}>
                        {act.actionType}
                      </Badge>
                      <span className="text-muted small" style={{ fontSize: '9.5px' }}>{getRelativeTime(act.createdAt)}</span>
                    </div>
                    <div className="theme-text-primary" style={{ wordBreak: 'break-word', lineHeight: '1.4' }}>
                      {act.commitMessage}
                    </div>
                    <div className="text-muted small mt-1" style={{ fontSize: '9.5px' }}>
                      Branch: <span className="font-monospace text-info">{act.branchName || 'none'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
