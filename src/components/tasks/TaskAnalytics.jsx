import { useState, useEffect } from 'react';
import { Card, Container, Row, Col, Spinner, Badge, ProgressBar, Alert } from 'react-bootstrap';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Clock, CheckCircle2, AlertCircle, Users, TrendingUp, Target } from 'lucide-react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import './TaskAnalytics.css';

export default function TaskAnalytics() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [analytics, setAnalytics] = useState({
    totalTasks: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    blockedTasks: 0,
    overdueTasks: 0,
    tasksByStatus: {},
    tasksByPriority: {},
    teamProductivity: [],
    completionRate: 0,
  });

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load tasks
      const tasksRef = collection(db, 'Tasks');
      const tasksSnap = await getDocs(tasksRef);
      const tasksData = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTasks(tasksData);

      // Load users
      const usersRef = collection(db, 'Users');
      const usersSnap = await getDocs(usersRef);
      const usersData = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
      setUsers(usersData);

      // Calculate analytics
      calculateAnalytics(tasksData, usersData);
    } catch (error) {
      console.error('Error loading analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateAnalytics = (tasksData, usersData) => {
    const now = new Date();
    
    // Count by status
    const statusCounts = {
      todo: 0,
      'in-progress': 0,
      review: 0,
      completed: 0,
      blocked: 0,
    };

    const priorityCounts = {
      low: 0,
      medium: 0,
      high: 0,
    };

    let completedCount = 0;
    let inProgressCount = 0;
    let blockedCount = 0;
    let overdueCount = 0;

    tasksData.forEach(task => {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
      priorityCounts[task.priority] = (priorityCounts[task.priority] || 0) + 1;

      if (task.status === 'completed') completedCount++;
      if (task.status === 'in-progress') inProgressCount++;
      if (task.status === 'blocked') blockedCount++;

      if (task.deadline && new Date(task.deadline) < now && 
          !['completed', 'blocked'].includes(task.status)) {
        overdueCount++;
      }
    });

    // Calculate team productivity
    const teamProductivity = usersData.map(user => {
      const userTasks = tasksData.filter(t => 
        t.createdBy === user.uid || 
        (t.assignedTo && t.assignedTo.some(a => a.userId === user.uid))
      );
      
      const userCompleted = userTasks.filter(t => t.status === 'completed').length;
      
      return {
        name: user.displayName || user.email?.split('@')[0] || 'User',
        total: userTasks.length,
        completed: userCompleted,
        inProgress: userTasks.filter(t => t.status === 'in-progress').length,
        productivity: userTasks.length > 0 ? Math.round((userCompleted / userTasks.length) * 100) : 0,
      };
    });

    const completionRate = tasksData.length > 0 
      ? Math.round((completedCount / tasksData.length) * 100)
      : 0;

    setAnalytics({
      totalTasks: tasksData.length,
      completedTasks: completedCount,
      inProgressTasks: inProgressCount,
      blockedTasks: blockedCount,
      overdueTasks: overdueCount,
      tasksByStatus: statusCounts,
      tasksByPriority: priorityCounts,
      teamProductivity,
      completionRate,
    });
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '400px' }}>
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  const statusData = [
    { name: 'To Do', value: analytics.tasksByStatus.todo || 0, fill: '#6c757d' },
    { name: 'In Progress', value: analytics.tasksByStatus['in-progress'] || 0, fill: '#667eea' },
    { name: 'Review', value: analytics.tasksByStatus.review || 0, fill: '#f5a623' },
    { name: 'Completed', value: analytics.tasksByStatus.completed || 0, fill: '#28a745' },
    { name: 'Blocked', value: analytics.tasksByStatus.blocked || 0, fill: '#dc3545' },
  ].filter(item => item.value > 0);

  const priorityData = [
    { name: 'Low', value: analytics.tasksByPriority.low || 0, fill: '#0dcaf0' },
    { name: 'Medium', value: analytics.tasksByPriority.medium || 0, fill: '#ffc107' },
    { name: 'High', value: analytics.tasksByPriority.high || 0, fill: '#dc3545' },
  ].filter(item => item.value > 0);

  return (
    <Container fluid className="task-analytics py-4">
      <div className="analytics-header mb-4">
        <h2 className="analytics-title">📊 Task Analytics Dashboard</h2>
        <p className="analytics-subtitle">Team productivity and task overview</p>
      </div>

      {/* Key Metrics */}
      <Row className="mb-4">
        <Col lg={3} md={6} className="mb-3">
          <Card className="metric-card">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <p className="metric-label">Total Tasks</p>
                  <h3 className="metric-value">{analytics.totalTasks}</h3>
                </div>
                <Target className="metric-icon" size={32} />
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={3} md={6} className="mb-3">
          <Card className="metric-card metric-success">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <p className="metric-label">Completed</p>
                  <h3 className="metric-value">{analytics.completedTasks}</h3>
                  <small className="text-muted">{analytics.completionRate}% completion</small>
                </div>
                <CheckCircle2 className="metric-icon" size={32} />
              </div>
              <ProgressBar 
                now={analytics.completionRate} 
                className="mt-2"
                style={{ height: '6px' }}
              />
            </Card.Body>
          </Card>
        </Col>

        <Col lg={3} md={6} className="mb-3">
          <Card className="metric-card metric-info">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <p className="metric-label">In Progress</p>
                  <h3 className="metric-value">{analytics.inProgressTasks}</h3>
                </div>
                <Clock className="metric-icon" size={32} />
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={3} md={6} className="mb-3">
          <Card className="metric-card metric-warning">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <p className="metric-label">Overdue</p>
                  <h3 className="metric-value">{analytics.overdueTasks}</h3>
                </div>
                <AlertCircle className="metric-icon" size={32} />
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row className="mb-4">
        <Col lg={6} className="mb-3">
          <Card className="chart-card">
            <Card.Header className="chart-header">
              <Card.Title className="mb-0">Tasks by Status</Card.Title>
            </Card.Header>
            <Card.Body>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Alert variant="info" className="mb-0">No tasks yet</Alert>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col lg={6} className="mb-3">
          <Card className="chart-card">
            <Card.Header className="chart-header">
              <Card.Title className="mb-0">Tasks by Priority</Card.Title>
            </Card.Header>
            <Card.Body>
              {priorityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={priorityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                    <XAxis dataKey="name" stroke="#6c757d" />
                    <YAxis stroke="#6c757d" />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #dee2e6',
                        borderRadius: '6px'
                      }}
                    />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {priorityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Alert variant="info" className="mb-0">No tasks yet</Alert>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Team Productivity */}
      <Row>
        <Col lg={12}>
          <Card className="chart-card">
            <Card.Header className="chart-header">
              <Card.Title className="d-flex align-items-center gap-2 mb-0">
                <Users size={20} />
                Team Productivity
              </Card.Title>
            </Card.Header>
            <Card.Body>
              {analytics.teamProductivity && analytics.teamProductivity.length > 0 ? (
                <div className="table-responsive">
                  <table className="productivity-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Total Tasks</th>
                        <th>Completed</th>
                        <th>In Progress</th>
                        <th>Productivity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.teamProductivity.map((member, idx) => (
                        <tr key={idx} className="productivity-row">
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <div className="member-avatar">
                                {member.name.charAt(0).toUpperCase()}
                              </div>
                              {member.name}
                            </div>
                          </td>
                          <td>
                            <Badge bg="light" text="dark">
                              {member.total}
                            </Badge>
                          </td>
                          <td>
                            <Badge bg="success">
                              {member.completed}
                            </Badge>
                          </td>
                          <td>
                            <Badge bg="info">
                              {member.inProgress}
                            </Badge>
                          </td>
                          <td>
                            <div className="productivity-bar">
                              <ProgressBar 
                                now={member.productivity}
                                label={`${member.productivity}%`}
                                className="productivity-progress"
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Alert variant="info" className="mb-0">No team members with tasks yet</Alert>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}
