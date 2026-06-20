import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Login from './components/Login';
import Register from './components/Register';
import ProtectedRoute from './components/ProtectedRoute';

// Layout & Pages
import MainLayout from './components/layout/MainLayout';
import Dashboard from './components/Dashboard';
import KanbanBoard from './components/KanbanBoard';
import Chat from './components/Chat';
import Analytics from './components/Analytics';
import Profile from './components/Profile';
import Projects from './components/Projects';

function App() {
  return (
    <AuthProvider>
      <div className="app">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          {/* Protected Main Layout */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            {/* Nested Routes inside MainLayout Outlet */}
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="kanban" element={<KanbanBoard />} />
            <Route path="chat" element={<Chat />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </div>
    </AuthProvider>
  );
}

export default App;
