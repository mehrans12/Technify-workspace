import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Container, Spinner } from 'react-bootstrap';

export default function ProtectedRoute({ children }) {
  const { currentUser } = useAuth();

  // If we wanted to add a loading state check from the AuthProvider, 
  // we would do it here to prevent flashing the login page on initial load.
  // For now, if there is no current user, redirect to login.

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  return children;
}
