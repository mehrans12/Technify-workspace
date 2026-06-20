import { useState } from 'react';
import { Form, Button, Card, Alert, Container } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    if (password !== passwordConfirm) {
      return setError('Passwords do not match');
    }

    try {
      setError('');
      setLoading(true);
      await signup(email, password, displayName);
      navigate('/');
    } catch (err) {
      setError('Failed to create an account: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    try {
      setError('');
      setLoading(true);
      await loginWithGoogle();
      navigate('/');
    } catch (err) {
      setError('Failed to sign up with Google: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: "100vh" }}>
      <div className="w-100" style={{ maxWidth: "400px" }}>
        <Card className="shadow-lg border-0 rounded-4 theme-card">
          <Card.Body className="p-4 p-md-5">
            <h2 className="text-center mb-4 fw-bold" style={{ color: "var(--accent)" }}>Sign Up</h2>
            
            {error && <Alert variant="danger">{error}</Alert>}
            
            <Form onSubmit={handleSubmit}>
              <Form.Group id="displayName" className="mb-3">
                <Form.Label className="theme-text-secondary small fw-bold">Display Name (Optional)</Form.Label>
                <Form.Control 
                  type="text" 
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="John Doe"
                />
              </Form.Group>

              <Form.Group id="email" className="mb-3">
                <Form.Label className="theme-text-secondary small fw-bold">Email</Form.Label>
                <Form.Control 
                  type="email" 
                  required 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                />
              </Form.Group>
              
              <Form.Group id="password" className="mb-3">
                <Form.Label className="theme-text-secondary small fw-bold">Password</Form.Label>
                <Form.Control 
                  type="password" 
                  required 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                />
              </Form.Group>

              <Form.Group id="password-confirm" className="mb-4">
                <Form.Label className="theme-text-secondary small fw-bold">Password Confirmation</Form.Label>
                <Form.Control 
                  type="password" 
                  required 
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="Confirm your password"
                />
              </Form.Group>
              
              <Button disabled={loading} className="w-100 mb-3 rounded-pill text-white fw-bold" type="submit" style={{ backgroundColor: "var(--accent)", border: "none" }}>
                Sign Up
              </Button>

              <div className="text-center mb-3 text-muted">OR</div>

              <Button 
                disabled={loading} 
                className="w-100 mb-3 rounded-pill d-flex align-items-center justify-content-center theme-text-primary theme-border" 
                variant="outline-secondary" 
                onClick={handleGoogleLogin}
              >
                <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="Google" className="me-2" style={{ width: '20px' }} />
                Sign up with Google
              </Button>
            </Form>
          </Card.Body>
        </Card>
        
        <div className="w-100 text-center mt-3">
          Already have an account? <Link to="/login" style={{ color: "var(--accent)" }}>Log In</Link>
        </div>
      </div>
    </Container>
  );
}
