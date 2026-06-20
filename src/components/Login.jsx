import { useState } from 'react';
import { Form, Button, Card, Alert, Container, Row, Col } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();

    try {
      setError('');
      setLoading(true);
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError('Failed to log in: ' + err.message);
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
      setError('Failed to log in with Google: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: "100vh" }}>
      <div className="w-100" style={{ maxWidth: "400px" }}>
        <Card className="shadow-lg border-0 rounded-4 theme-card">
          <Card.Body className="p-4 p-md-5">
            <h2 className="text-center mb-4 fw-bold" style={{ color: "var(--accent)" }}>Log In</h2>
            
            {error && <Alert variant="danger">{error}</Alert>}
            
            <Form onSubmit={handleSubmit}>
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
              
              <Form.Group id="password" className="mb-4">
                <Form.Label className="theme-text-secondary small fw-bold">Password</Form.Label>
                <Form.Control 
                  type="password" 
                  required 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                />
              </Form.Group>
              
              <Button disabled={loading} className="w-100 mb-3 rounded-pill text-white fw-bold" type="submit" style={{ backgroundColor: "var(--accent)", border: "none" }}>
                Log In
              </Button>

              <div className="text-center mb-3 text-muted">OR</div>

              <Button 
                disabled={loading} 
                className="w-100 mb-3 rounded-pill d-flex align-items-center justify-content-center theme-text-primary theme-border" 
                variant="outline-secondary" 
                onClick={handleGoogleLogin}
              >
                <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="Google" className="me-2" style={{ width: '20px' }} />
                Sign in with Google
              </Button>
            </Form>
          </Card.Body>
        </Card>
        
        <div className="w-100 text-center mt-3">
          Need an account? <Link to="/register" style={{ color: "var(--accent)" }}>Sign Up</Link>
        </div>
      </div>
    </Container>
  );
}
