/**
 * PresenceBar Component (Enhanced)
 * 
 * Displays a real-time horizontal presence bar at the bottom of the editor.
 * Shows connected collaborators with:
 * - Animated typing indicators ("Ali is typing...")
 * - File awareness (who is viewing/editing which file)
 * - Color-coded presence dots
 * - Live status badges
 * 
 * Integrates with both Yjs awareness and Socket.IO presence data.
 */

import React, { useMemo } from 'react';
import { OverlayTrigger, Tooltip, Badge } from 'react-bootstrap';
import { Eye, Edit2, Clock, Keyboard } from 'lucide-react';

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

export default function PresenceBar({ presenceList, awarenessUsers = [], currentUid }) {
  // Merge socket presence + awareness data (awareness takes priority for typing status)
  const mergedUsers = useMemo(() => {
    const awarenessMap = new Map();
    awarenessUsers.forEach(u => {
      if (u.uid) awarenessMap.set(u.uid, u);
    });

    // Start from socket presence list
    const merged = (presenceList || []).map(user => {
      const awareness = awarenessMap.get(user.uid);
      return {
        ...user,
        status: awareness?.status || user.status || 'viewing',
        activeFile: awareness?.activeFile || user.file,
      };
    });

    // Add any awareness users not in socket presence
    awarenessUsers.forEach(u => {
      if (!merged.find(m => m.uid === u.uid)) {
        merged.push({
          uid: u.uid,
          name: u.name || 'User',
          status: u.status || 'viewing',
          file: u.activeFile,
          activeFile: u.activeFile,
          lastActive: Date.now(),
        });
      }
    });

    return merged;
  }, [presenceList, awarenessUsers]);

  // Typing users (excluding self)
  const typingUsers = useMemo(() => {
    return mergedUsers.filter(u => u.status === 'typing' && u.uid !== currentUid);
  }, [mergedUsers, currentUid]);

  if (mergedUsers.length === 0 && typingUsers.length === 0) return null;

  return (
    <div className="presence-bar">
      {/* Typing indicator - most prominent */}
      {typingUsers.length > 0 && (
        <div className="presence-typing-indicator">
          <div className="presence-typing-dots">
            <span /><span /><span />
          </div>
          <span className="presence-typing-text">
            {typingUsers.length === 1
              ? `${typingUsers[0].name} is typing`
              : `${typingUsers.map(u => u.name).join(', ')} are typing`
            }
          </span>
        </div>
      )}

      {/* Separator if both typing and users */}
      {typingUsers.length > 0 && mergedUsers.length > 0 && (
        <div className="presence-separator" />
      )}

      {/* User pills */}
      {mergedUsers.map((user, idx) => {
        const isSelf = user.uid === currentUid;
        const color = getUserColor(user.uid);
        const filePath = user.activeFile || user.file;
        const fileDisplay = filePath ? filePath.split('/').pop() : '';
        const status = user.status || 'viewing';

        const tooltip = (
          <Tooltip id={`presence-tooltip-${idx}`}>
            <div className="text-start p-1">
              <strong>{user.name}</strong> {isSelf && '(You)'}
              <br />
              <span className="text-muted" style={{ fontSize: '10.5px' }}>
                {status === 'typing' ? `Typing in ${fileDisplay || 'a file'}` :
                 status === 'editing' ? `Editing ${fileDisplay || 'a file'}` :
                 status === 'viewing' ? `Viewing ${fileDisplay || 'a file'}` : 'Idle'}
              </span>
              {user.lastActive && (
                <div className="text-muted small mt-1" style={{ fontSize: '9px' }}>
                  Last active: {new Date(user.lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              )}
            </div>
          </Tooltip>
        );

        return (
          <OverlayTrigger key={idx} placement="top" overlay={tooltip}>
            <div className={`presence-indicator d-flex align-items-center gap-1.5 px-2 py-1 rounded-pill ${status === 'typing' ? 'presence-indicator-typing' : ''}`}>
              {/* User Avatar Circle */}
              <div 
                className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold text-uppercase text-center"
                style={{ width: '16px', height: '16px', fontSize: '8.5px', backgroundColor: color, flexShrink: 0 }}
              >
                {user.name?.charAt(0)}
              </div>

              {/* User Name */}
              <span className="fw-semibold theme-text-primary" style={{ fontSize: '10.5px' }}>
                {user.name} {isSelf && '(You)'}
              </span>

              {/* Status Badge */}
              {status === 'typing' ? (
                <Badge bg="warning" className="d-flex align-items-center gap-1 py-0.5 px-1.5 rounded-pill presence-badge-typing" style={{ fontSize: '9px' }}>
                  <Keyboard size={8} /> Typing
                </Badge>
              ) : status === 'editing' ? (
                <Badge bg="danger" className="d-flex align-items-center gap-1 py-0.5 px-1.5 rounded-pill animate-pulse" style={{ fontSize: '9px' }}>
                  <Edit2 size={8} /> Editing {fileDisplay}
                </Badge>
              ) : status === 'viewing' ? (
                <Badge bg="info" className="d-flex align-items-center gap-1 py-0.5 px-1.5 rounded-pill" style={{ fontSize: '9px' }}>
                  <Eye size={8} /> Viewing {fileDisplay}
                </Badge>
              ) : (
                <Badge bg="secondary" className="d-flex align-items-center gap-1 py-0.5 px-1.5 rounded-pill" style={{ fontSize: '9px' }}>
                  <Clock size={8} /> Idle
                </Badge>
              )}
            </div>
          </OverlayTrigger>
        );
      })}
    </div>
  );
}
