import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, KanbanSquare, MessageSquare, BarChart3, User, X, Folder, LogOut } from 'lucide-react';
import { Button } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';

export default function Sidebar({ collapsed, toggleSidebar }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await logout();
      navigate('/login');
      toggleSidebar();
    } catch (error) {
      console.error('Failed to log out', error);
    }
  }

  const navItems = [
    { path: '/', label: 'Workspace', icon: LayoutDashboard },
    { path: '/projects', label: 'Projects', icon: Folder },
    { path: '/kanban', label: 'Kanban Board', icon: KanbanSquare },
    { path: '/chat', label: 'Chat', icon: MessageSquare },
    { path: '/analytics', label: 'Analytics', icon: BarChart3 },
    { path: '/profile', label: 'Profile', icon: User },
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} d-flex`}>
      <div className="d-flex align-items-center justify-content-between p-3 w-100" style={{ height: '64px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="fw-bold text-light ms-2 text-truncate" style={{ fontSize: '18px' }}>
          <span style={{ color: "var(--accent)" }}>Tech</span>nify
        </span>
        <Button 
          variant="link" 
          className="p-1 ms-auto text-muted d-flex align-items-center justify-content-center border-0" 
          onClick={toggleSidebar}
          style={{ outline: 'none', boxShadow: 'none' }}
        >
          <X size={20} className="text-light" />
        </Button>
      </div>

      <nav className="flex-grow-1 py-4 d-flex flex-column gap-1 w-100">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => 
                `sidebar-nav-link ${isActive ? 'active' : ''}`
              }
              end={item.path === '/'}
              onClick={toggleSidebar} // auto-close drawer when navigating
            >
              <Icon size={20} className="icon" />
              <span className="text ms-3">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
      
      <div className="p-4 mt-auto w-100">
        <Button 
          onClick={handleLogout}
          size="sm" 
          variant="outline-danger" 
          className="w-100 rounded-pill d-flex align-items-center justify-content-center gap-2" 
          style={{ fontSize: '12px', transition: 'all 0.2s' }}
        >
          <LogOut size={14} />
          <span>Log Out</span>
        </Button>
      </div>
    </aside>
  );
}
