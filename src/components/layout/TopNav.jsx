import { useState } from 'react';
import { Button } from 'react-bootstrap';
import { LogOut, Menu, Sun, Moon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';

export default function TopNav({ toggleSidebar }) {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme, isDark } = useTheme();

  async function handleLogout() {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
    }
  }

  return (
    <header className="top-nav d-flex align-items-center justify-content-between px-3" style={{ height: '64px', backgroundColor: 'var(--bg-header)', borderBottom: '2px solid var(--border-subtle)' }}>
      {/* Left Section */}
      <div className="d-flex align-items-center gap-3">
        {/* Manage Team Button */}
        <Button
          onClick={toggleSidebar}
          className="btn-sm d-flex align-items-center gap-2 border-0 px-3 py-2 fw-bold"
          style={{
            backgroundColor: '#00d2ff',
            color: '#000000',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '700',
            transition: 'background-color 0.2s ease',
            outline: 'none',
            boxShadow: 'none'
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#00b8e6'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#00d2ff'}
        >
          <Menu size={16} style={{ pointerEvents: 'none' }} />
          <span style={{ pointerEvents: 'none' }}>Manage Team</span>
        </Button>

        {/* Circular Logo */}
        <div
          className="d-flex align-items-center justify-content-center"
          style={{
            width: '32px',
            height: '32px',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="border-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#80f5d2" />
                <stop offset="50%" stopColor="#4bc5e8" />
                <stop offset="100%" stopColor="#3d82db" />
              </linearGradient>
              <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2c4275" />
                <stop offset="50%" stopColor="#1c244c" />
                <stop offset="100%" stopColor="#0d0f26" />
              </linearGradient>
              <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation="1" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <circle cx="50" cy="50" r="46" stroke="url(#border-grad)" strokeWidth="6" fill="none" />
            <circle cx="50" cy="50" r="39" fill="url(#bg-grad)" />
            <path d="M 33 22 L 48 22 L 48 41 L 63 41" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 23 33 L 33 33" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            <path d="M 33 45 L 48 45" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            <path d="M 20 59 L 48 59 C 48 67, 50 67, 83 67" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 23 75 L 59 75" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            <path d="M 50 28 L 65 28" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            <path d="M 50 51 L 83 51" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
            <circle cx="59" cy="28" r="4.5" fill="#80f5d2" stroke="#ffffff" strokeWidth="1.5" filter="url(#glow)" />
            <circle cx="68" cy="41" r="4.5" fill="#80f5d2" stroke="#ffffff" strokeWidth="1.5" filter="url(#glow)" />
            <circle cx="33" cy="33" r="4.5" fill="#80f5d2" stroke="#ffffff" strokeWidth="1.5" filter="url(#glow)" />
            <circle cx="28" cy="45" r="4.5" fill="#80f5d2" stroke="#ffffff" strokeWidth="1.5" filter="url(#glow)" />
            <circle cx="35" cy="59" r="4.5" fill="#80f5d2" stroke="#ffffff" strokeWidth="1.5" filter="url(#glow)" />
            <circle cx="59" cy="51" r="4.5" fill="#80f5d2" stroke="#ffffff" strokeWidth="1.5" filter="url(#glow)" />
            <circle cx="65" cy="75" r="4.5" fill="#80f5d2" stroke="#ffffff" strokeWidth="1.5" filter="url(#glow)" />
          </svg>
        </div>

        {/* Title */}
        <h5 className="mb-0 fw-bold d-none d-md-block" style={{ fontSize: '18px', letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>
          Technify <span style={{ color: 'var(--accent)' }}>Workspace</span>
        </h5>
      </div>

      {/* Right Section */}
      <div className="d-flex align-items-center gap-3">
        {/* Light/Dark Mode Button */}
        <Button
          variant="outline-warning"
          size="sm"
          className="d-flex align-items-center gap-1 px-3 py-1 fw-semibold"
          style={{
            fontSize: '12px',
            color: '#ffb300',
            borderColor: '#ffb300',
            backgroundColor: 'transparent',
            outline: 'none',
            boxShadow: 'none'
          }}
          onClick={toggleTheme}
        >
          {isDark ? (
            <>
              <Sun size={13} style={{ pointerEvents: 'none' }} />
              <span style={{ pointerEvents: 'none' }}>Light</span>
            </>
          ) : (
            <>
              <Moon size={13} style={{ pointerEvents: 'none' }} />
              <span style={{ pointerEvents: 'none' }}>Dark</span>
            </>
          )}
        </Button>

        {/* Connection Status */}
        <div className="d-flex align-items-center gap-2" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          <span>Status:</span>
          <span className="fw-semibold d-flex align-items-center gap-2" style={{ color: '#2ea44f' }}>
            <span
              className="d-inline-block rounded-circle"
              style={{
                width: '8px',
                height: '8px',
                backgroundColor: '#2ea44f',
                boxShadow: '0 0 8px #2ea44f',
                animation: 'pulse 1.5s infinite'
              }}
            />
            Connected
          </span>
        </div>

        {/* Logout Button */}
        <Button
          onClick={handleLogout}
          variant="outline-danger"
          size="sm"
          className="px-3 py-1 rounded-2 fw-semibold"
          style={{
            fontSize: '12px',
            color: '#dc3545',
            borderColor: '#dc3545',
            backgroundColor: 'transparent',
            outline: 'none',
            boxShadow: 'none',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = '#dc3545';
            e.target.style.color = '#ffffff';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
            e.target.style.color = '#dc3545';
          }}
        >
          Log Out
        </Button>
      </div>
    </header>
  );
}
