import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Send, Plus, Hash, MessageSquare, Lock, Paperclip, FileText, X, Code, ExternalLink } from 'lucide-react';
import { Button, Form, Modal, InputGroup, Badge, ListGroup } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [activeChatRoom, setActiveChatRoom] = useState('global');
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [newRoomId, setNewRoomId] = useState('');
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [myMemberships, setMyMemberships] = useState(new Set());
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Mentions Autocomplete State
  const [roomMembers, setRoomMembers] = useState([]);
  const [showMentionsDropdown, setShowMentionsDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionIndex, setMentionIndex] = useState(-1);

  // File Sharing State
  const [showShareModal, setShowShareModal] = useState(false);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFileShare, setSelectedFileShare] = useState(null);

  // Subscribe to user memberships
  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'WorkspaceMembers'), where('userId', '==', currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const roomIds = new Set(snapshot.docs.map(doc => doc.data().workspaceId));
      setMyMemberships(roomIds);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Load Room Members for mentions autocomplete
  useEffect(() => {
    if (!activeChatRoom) return;
    
    let unsubscribe;
    if (activeChatRoom === 'global') {
      const q = query(collection(db, 'Users'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            uid: doc.id,
            username: data.displayName || data.email?.split('@')[0] || 'User'
          };
        });
        setRoomMembers(list);
      });
    } else {
      const q = query(collection(db, 'WorkspaceMembers'), where('workspaceId', '==', activeChatRoom));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            uid: data.userId || doc.id,
            username: data.userName || data.userEmail?.split('@')[0] || 'User'
          };
        });
        setRoomMembers(list);
      });
    }
    return () => unsubscribe();
  }, [activeChatRoom]);

  // Load files for workspace file sharing
  const loadWorkspaceFiles = async () => {
    if (!activeChatRoom) return;
    setLoadingFiles(true);
    try {
      const response = await fetch(`${API_BASE}/api/workspace/files?roomId=${activeChatRoom}`);
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
      console.error('Error loading files for sharing:', e);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (showShareModal) {
      loadWorkspaceFiles();
    }
  }, [showShareModal]);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeChatRoom, scrollToBottom]);

  // Subscribe to Available Rooms list from Firestore
  useEffect(() => {
    const q = query(collection(db, 'Rooms'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAvailableRooms(list);
    });
    return () => unsubscribe();
  }, []);

  // Proactively register 'global' room in Firestore
  useEffect(() => {
    const registerGlobal = async () => {
      try {
        const roomRef = doc(db, 'Rooms', 'global');
        const roomDoc = await getDoc(roomRef);
        if (!roomDoc.exists()) {
          await setDoc(roomRef, {
            id: 'global',
            name: 'global',
            createdAt: serverTimestamp(),
            ownerId: 'system',
            createdBy: 'System'
          });
        }
      } catch (e) {
        console.error('Error auto-registering global room:', e);
      }
    };
    registerGlobal();
  }, []);

  // Real-time Messages listener from Firestore
  useEffect(() => {
    const q = query(
      collection(db, 'Messages'), 
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, []);

  // Filter messages locally by active room ID
  const filteredMessages = messages.filter(msg => {
    const msgRoomId = msg.roomId || 'global';
    return msgRoomId === activeChatRoom;
  });

  // Handle Input Changes & Mentions Autocomplete Detection
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
      setShowMentionsDropdown(true);
    } else {
      setShowMentionsDropdown(false);
    }
  };

  const selectMention = (username) => {
    const beforeMention = newMessage.slice(0, mentionIndex);
    const afterMention = newMessage.slice(mentionIndex + mentionSearch.length + 1);
    const newText = beforeMention + `@${username} ` + afterMention;
    setNewMessage(newText);
    setShowMentionsDropdown(false);
    inputRef.current?.focus();
  };

  const filteredMembers = roomMembers.filter(member => 
    member.username.toLowerCase().includes(mentionSearch)
  );

  // Parse text for triple backtick code snippets
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

  // Create a new room
  async function handleCreateRoom(e) {
    e.preventDefault();
    const cleanRoom = newRoomId.trim().toLowerCase().replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanRoom) return;

    try {
      const roomRef = doc(db, 'Rooms', cleanRoom);
      const roomDoc = await getDoc(roomRef);
      if (!roomDoc.exists()) {
        await setDoc(roomRef, {
          id: cleanRoom,
          name: cleanRoom,
          createdAt: serverTimestamp(),
          ownerId: currentUser.uid,
          createdBy: currentUser.displayName || currentUser.email?.split('@')[0] || 'User'
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
      setActiveChatRoom(cleanRoom);
      setShowRoomModal(false);
      setNewRoomId('');
    } catch (error) {
      console.error('Error creating chat room:', error);
    }
  }

  // Send a new message
  async function handleSend(e) {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedFileShare) || sending) return;

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
        roomId: activeChatRoom,
        fileShare: selectedFileShare || null
      };

      const docRef = await addDoc(collection(db, 'Messages'), messageDoc);

      if (window.socket) {
        window.socket.emit('chat-message', {
          roomId: activeChatRoom,
          message: {
            id: docRef.id,
            ...messageDoc,
            timestamp: Date.now()
          }
        });

        if (mentions.length > 0) {
          window.socket.emit('send-notification', {
            roomId: activeChatRoom,
            notification: {
              message: `${messageDoc.senderName} mentioned you in #${activeChatRoom}`,
              type: 'mention',
              targetUsernames: mentions,
              senderName: messageDoc.senderName,
              timestamp: Date.now()
            }
          });
        }
      }

      setNewMessage('');
      setSelectedFileShare(null);
      setShowMentionsDropdown(false);
    } catch (error) {
      console.error('Error sending message:', error);
    }
    setSending(false);
  }

  // Handle clicking on a shared file
  const handleFileShareClick = (file) => {
    if (!file || !file.path) return;
    navigate(`/?room=${activeChatRoom}&openFile=${encodeURIComponent(file.path)}`);
  };

  // Get avatar initial from sender name
  function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : 'U';
  }

  // Format timestamp
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const visibleRooms = availableRooms.filter(room => {
    if (room.id === 'global') return true;
    if (room.ownerId === currentUser?.uid) return true;
    return myMemberships.has(room.id);
  });

  const hasChatAccess = activeChatRoom === 'global' || 
                        availableRooms.find(r => r.id === activeChatRoom)?.ownerId === currentUser?.uid ||
                        myMemberships.has(activeChatRoom);

  return (
    <div className="d-flex" style={{ height: 'calc(100vh - 112px)', margin: '-24px' }}>
      
      {/* Rooms Sidebar */}
      <div 
        className="d-flex flex-column p-3 flex-shrink-0" 
        style={{ 
          width: '240px', 
          backgroundColor: 'var(--bg-card)', 
          borderRight: '1px solid var(--border-subtle)' 
        }}
      >
        <div className="d-flex align-items-center justify-content-between mb-4 px-2">
          <h6 className="fw-bold theme-text-primary mb-0 d-flex align-items-center gap-2">
            <MessageSquare size={16} className="text-primary" style={{ color: 'var(--accent)' }} />
            <span>Chat Rooms</span>
          </h6>
          <Button 
            variant="link" 
            className="p-1 text-muted" 
            onClick={() => setShowRoomModal(true)}
            style={{ color: 'var(--text-muted)' }}
          >
            <Plus size={18} />
          </Button>
        </div>

        {/* Scrollable Rooms List */}
        <div className="flex-grow-1 overflow-auto d-flex flex-column gap-1 pr-1">
          {visibleRooms.map((room) => (
            <button
              key={room.id}
              onClick={() => setActiveChatRoom(room.id)}
              className="btn btn-link text-start text-decoration-none py-2 px-3 rounded-3 d-flex align-items-center justify-content-between border-0"
              style={{
                fontSize: '13px',
                color: room.id === activeChatRoom ? 'var(--text-primary)' : 'var(--text-muted)',
                backgroundColor: room.id === activeChatRoom ? 'rgba(102, 126, 234, 0.12)' : 'transparent',
                fontWeight: room.id === activeChatRoom ? 'bold' : 'normal',
                outline: 'none',
                boxShadow: 'none'
              }}
            >
              <div className="d-flex align-items-center gap-2 text-truncate">
                <Hash size={13} className={room.id === activeChatRoom ? 'text-primary' : 'text-muted'} />
                <span className="text-truncate">{room.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Messages Panel */}
      <div className="flex-grow-1 d-flex flex-column p-4 position-relative" style={{ backgroundColor: 'var(--bg-dark)' }}>
        <div className="d-flex align-items-center gap-2 mb-3 pb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <Hash size={18} className="text-warning" />
          <h5 className="mb-0 fw-bold theme-text-primary">{activeChatRoom}</h5>
        </div>

        {!hasChatAccess ? (
          <div className="flex-grow-1 d-flex flex-column align-items-center justify-content-center text-center p-5 rounded-3" style={{ backgroundColor: 'var(--bg-card)' }}>
            <div className="p-4 rounded-circle mb-4" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent)' }}>
              <Lock size={48} />
            </div>
            <h4 className="fw-bold theme-text-primary mb-2">Private Chat Room</h4>
            <p className="text-muted mb-4" style={{ maxWidth: '400px', fontSize: '14px' }}>
              You are not a member of this workspace chat room. You need an invitation from the room owner to view and participate in this discussion.
            </p>
          </div>
        ) : (
          <>
            {/* Messages Area */}
            <div 
              ref={chatContainerRef}
              className="flex-grow-1 rounded-3 p-3 mb-3 overflow-auto"
              style={{ backgroundColor: 'var(--bg-card)' }}
            >
              {filteredMessages.length === 0 ? (
                <div className="h-100 d-flex flex-column align-items-center justify-content-center text-muted">
                  <MessageSquare size={36} className="mb-2 opacity-50" />
                  <p className="small mb-0">No messages in #{activeChatRoom} yet.</p>
                  <p className="small text-muted">Start the conversation below!</p>
                </div>
              ) : (
                filteredMessages.map((msg) => {
                  const isMe = msg.senderUid === currentUser.uid;
                  return (
                    <div
                      key={msg.id}
                      className={`d-flex mb-3 ${isMe ? 'justify-content-end' : 'justify-content-start'}`}
                    >
                      {/* Other user's avatar */}
                      {!isMe && (
                        <div
                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold me-2 flex-shrink-0"
                          style={{
                            width: '36px',
                            height: '36px',
                            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                            fontSize: '14px'
                          }}
                        >
                          {getInitial(msg.senderName)}
                        </div>
                      )}

                      {/* Message Bubble */}
                      <div
                        className="rounded-3 p-2 px-3"
                        style={{
                          maxWidth: '70%',
                          backgroundColor: isMe ? 'var(--accent)' : 'var(--bg-secondary)',
                          color: isMe ? (theme === 'dark' ? '#000' : '#fff') : 'var(--text-primary)',
                          border: isMe ? 'none' : '1px solid var(--border-subtle)'
                        }}
                      >
                        {!isMe && (
                          <div className="fw-bold mb-1" style={{ fontSize: '12px', color: 'var(--accent)' }}>
                            {msg.senderName}
                          </div>
                        )}
                        
                        {/* Text and Snippets rendering */}
                        <div style={{ fontSize: '14px', wordBreak: 'break-word' }}>
                          {formatMessageText(msg.text).map((part, index) => {
                            if (part.type === 'code') {
                              return (
                                <div key={index} className="chat-code-snippet my-2 rounded theme-border theme-bg-secondary theme-text-primary p-2 font-monospace" style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                                  {part.language && <div className="text-muted border-bottom theme-border pb-1 mb-2 text-uppercase fw-bold" style={{ fontSize: '10px' }}>{part.language}</div>}
                                  <code>{part.content}</code>
                                </div>
                              );
                            }
                            return <span key={index}>{part.content}</span>;
                          })}
                        </div>

                        {/* Attached shared workspace file */}
                        {msg.fileShare && (
                          <div className="mt-2">
                            <Badge 
                              bg={theme === 'dark' ? 'dark' : 'light'} 
                              className="file-share-badge d-inline-flex align-items-center gap-2 p-2 border theme-border text-info cursor-pointer"
                              style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                              onClick={() => handleFileShareClick(msg.fileShare)}
                            >
                              <FileText size={13} />
                              <span className="theme-text-primary small">{msg.fileShare.name}</span>
                              <ExternalLink size={10} className="ms-1" />
                            </Badge>
                          </div>
                        )}

                        <div className="text-end mt-1" style={{ fontSize: '11px', opacity: 0.6 }}>
                          {formatTime(msg.timestamp)}
                        </div>
                      </div>

                      {/* My avatar */}
                      {isMe && (
                        <div
                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold ms-2 flex-shrink-0"
                          style={{
                            width: '36px',
                            height: '36px',
                            background: 'var(--primary-gradient)',
                            fontSize: '14px'
                          }}
                        >
                          {getInitial(msg.senderName)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Mentions Dropdown Autocomplete menu */}
            {showMentionsDropdown && filteredMembers.length > 0 && (
              <ListGroup 
                className="mentions-autocomplete position-absolute shadow-lg border theme-border"
                style={{
                  bottom: '72px',
                  left: '24px',
                  zIndex: 1050,
                  maxWidth: '240px',
                  maxHeight: '180px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '6px'
                }}
              >
                {filteredMembers.map(member => (
                  <ListGroup.Item
                    key={member.uid}
                    action
                    onClick={() => selectMention(member.username)}
                    className="theme-bg-secondary theme-text-primary border-0 py-2 px-3 small d-flex align-items-center gap-2"
                    style={{ fontSize: '13px' }}
                  >
                    <div className="rounded-circle bg-secondary d-flex align-items-center justify-content-center text-white font-weight-bold" style={{ width: '22px', height: '22px', fontSize: '11px' }}>
                      {member.username.charAt(0).toUpperCase()}
                    </div>
                    <span>{member.username}</span>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}

            {/* Selected File Share Preview */}
            {selectedFileShare && (
              <div className="d-flex align-items-center gap-2 mb-2 p-2 rounded theme-bg-secondary border theme-border" style={{ maxWidth: '300px' }}>
                <FileText size={16} className="text-info" />
                <span className="theme-text-primary small text-truncate flex-grow-1">{selectedFileShare.name}</span>
                <Button variant="link" className="p-0 text-muted" onClick={() => setSelectedFileShare(null)}>
                  <X size={14} />
                </Button>
              </div>
            )}

            {/* Message Input Form */}
            <Form onSubmit={handleSend} className="d-flex gap-2">
              {activeChatRoom !== 'global' && (
                <Button 
                  variant="outline-secondary"
                  onClick={() => setShowShareModal(true)}
                  className="d-flex align-items-center justify-content-center px-3"
                  style={{ outline: 'none', boxShadow: 'none' }}
                  title="Share workspace file"
                >
                  <Paperclip size={16} />
                </Button>
              )}
              <Form.Control
                ref={inputRef}
                type="text"
                placeholder={`Message #${activeChatRoom}...`}
                value={newMessage}
                onChange={handleInputChange}
                className="rounded-3"
                disabled={sending}
                autoComplete="off"
              />
              <Button 
                type="submit" 
                variant="primary" 
                disabled={(!newMessage.trim() && !selectedFileShare) || sending}
                className="d-flex align-items-center px-4 rounded-3"
                style={{ background: 'var(--primary-gradient)', border: 'none' }}
              >
                <Send size={16} />
              </Button>
            </Form>
          </>
        )}
      </div>

      {/* Create Room Modal */}
      <Modal 
        show={showRoomModal} 
        onHide={() => setShowRoomModal(false)} 
        centered 
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="theme-border">
          <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
            <Plus size={20} className="me-2 text-warning" /> Create Chat Room
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleCreateRoom}>
            <Form.Group className="mb-3">
              <Form.Label style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Room Name / Project Name</Form.Label>
              <InputGroup>
                <InputGroup.Text className="theme-bg-secondary theme-text-primary theme-border">#</InputGroup.Text>
                <Form.Control
                  type="text"
                  placeholder="e.g. mobile-app, design-team"
                  value={newRoomId}
                  onChange={(e) => setNewRoomId(e.target.value.replace(/[^a-zA-Z0-9_\-]/g, '').trim().toLowerCase())}
                  autoFocus
                  required
                />
              </InputGroup>
            </Form.Group>
            <div className="d-flex justify-content-end gap-2 mt-4">
              <Button variant="outline-secondary" size="sm" onClick={() => setShowRoomModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" style={{ background: 'var(--primary-gradient)', border: 'none' }}>
                Create Room
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Share Workspace File Modal */}
      <Modal 
        show={showShareModal} 
        onHide={() => setShowShareModal(false)} 
        centered 
        contentClassName="theme-modal border-secondary"
      >
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="theme-border">
          <Modal.Title className="d-flex align-items-center" style={{ fontSize: '18px' }}>
            <Paperclip size={20} className="me-2 text-info" /> Share Workspace File
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {loadingFiles ? (
            <div className="text-center py-4">
              <span className="spinner-border text-info spinner-border-sm" role="status" />
              <div className="text-muted small mt-2">Loading workspace files...</div>
            </div>
          ) : workspaceFiles.length === 0 ? (
            <div className="text-center text-muted py-4">
              <FileText size={24} className="mb-2 opacity-50" />
              <div>No files found in workspace</div>
            </div>
          ) : (
            <ListGroup>
              {workspaceFiles.map((file, idx) => (
                <ListGroup.Item
                  key={idx}
                  action
                  onClick={() => {
                    setSelectedFileShare({ path: file.path, name: file.name });
                    setShowShareModal(false);
                  }}
                  className="theme-bg-secondary theme-text-primary theme-border py-2 px-3 small d-flex align-items-center justify-content-between"
                >
                  <div className="d-flex align-items-center gap-2 text-truncate">
                    <FileText size={14} className="text-info" />
                    <div className="text-truncate">
                      <div className="text-truncate font-weight-bold">{file.name}</div>
                      <div className="text-muted font-monospace" style={{ fontSize: '10px' }}>{file.path}</div>
                    </div>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Modal.Body>
        <Modal.Footer className="border-secondary">
          <Button variant="outline-secondary" size="sm" onClick={() => setShowShareModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

    </div>
  );
}
