import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import { io } from 'socket.io-client';
import { useAuth } from '../../contexts/AuthContext';
import { Toast, ToastContainer } from 'react-bootstrap';
import { Bell, Info, AlertTriangle, CheckCircle, MessageSquare } from 'lucide-react';

export default function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const { currentUser } = useAuth();
  const [toasts, setToasts] = useState([]);

  const toggleSidebar = () => setSidebarCollapsed(!sidebarCollapsed);

  // Setup persistent Socket.IO connection
  useEffect(() => {
    if (!currentUser) return;

    const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
    const newSocket = io(API_BASE, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000
    });

    window.socket = newSocket;

    const activeRoom = localStorage.getItem('activeRoom') || 'global';
    const name = currentUser.displayName || currentUser.email.split('@')[0];
    
    const joinData = {
      roomId: activeRoom,
      uid: currentUser.uid,
      name,
      avatar: currentUser.photoURL || ''
    };

    newSocket.on('connect', () => {
      newSocket.emit('join-room', joinData);
    });

    if (newSocket.connected) {
      newSocket.emit('join-room', joinData);
    }

    // Global listener for real-time notification toasts
    newSocket.on('notification', (notif) => {
      // Filter mentions to only toast if we are the user mentioned
      if (notif.type === 'mention') {
        const username = currentUser.displayName || currentUser.email.split('@')[0];
        if (!notif.targetUsernames || !notif.targetUsernames.map(u => u.toLowerCase()).includes(username.toLowerCase())) {
          return;
        }
      }

      // Filter task assignments to only toast if it's assigned to us
      if (notif.type === 'task-assign') {
        if (notif.targetUserId !== currentUser.uid) {
          return;
        }
      }

      // Add to toasts list
      const id = Date.now() + Math.random().toString(36).substr(2, 9);
      setToasts(prev => [...prev, { id, ...notif }]);

      // Auto dismiss after 4 seconds
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    });

    return () => {
      newSocket.disconnect();
      window.socket = null;
    };
  }, [currentUser]);

  const getNotifIcon = (type) => {
    switch (type) {
      case 'mention':
        return <MessageSquare size={16} className="text-warning" />;
      case 'git-push':
        return <Info size={16} className="text-success" />;
      case 'task-assign':
        return <Bell size={16} className="text-primary" style={{ color: 'var(--accent)' }} />;
      case 'task-status':
        return <CheckCircle size={16} className="text-info" />;
      default:
        return <Info size={16} className="text-light" />;
    }
  };

  return (
    <div className="layout-container">
      {/* Sidebar Drawer */}
      <Sidebar collapsed={sidebarCollapsed} toggleSidebar={toggleSidebar} />
      
      {/* Backdrop for open drawer */}
      {!sidebarCollapsed && (
        <div 
          className="drawer-backdrop" 
          onClick={() => setSidebarCollapsed(true)} 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 999,
            transition: 'opacity 0.25s ease'
          }}
        />
      )}
      
      <div className="main-content-wrapper">
        <TopNav toggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} />
        
        <main className="main-content">
          <Outlet />
        </main>
      </div>

      {/* Global Toast Stack */}
      <ToastContainer 
        position="top-end" 
        className="p-3" 
        style={{ 
          position: 'fixed', 
          top: '72px', 
          right: '12px', 
          zIndex: 9999, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '8px' 
        }}
      >
        {toasts.map((toast) => (
          <Toast 
            key={toast.id}
            onClose={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
            className="border-0 shadow-lg text-white"
            style={{
              backgroundColor: 'rgba(18, 19, 26, 0.85)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              minWidth: '280px'
            }}
          >
            <Toast.Header 
              closeButton 
              closeVariant="white"
              className="bg-transparent text-white border-0 py-2"
              style={{ fontSize: '11px', borderBottom: 'none' }}
            >
              <div className="d-flex align-items-center gap-2 me-auto fw-bold" style={{ color: 'var(--accent)' }}>
                {getNotifIcon(toast.type)}
                <span className="text-uppercase" style={{ letterSpacing: '0.5px' }}>{toast.type || 'Notification'}</span>
              </div>
              <small className="text-muted">just now</small>
            </Toast.Header>
            <Toast.Body className="pt-0 pb-3" style={{ fontSize: '13px', lineHeight: '1.4', color: '#e2e8f0' }}>
              {toast.message}
            </Toast.Body>
          </Toast>
        ))}
      </ToastContainer>
    </div>
  );
}
