import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { Card, Row, Col, ButtonGroup, Button, Spinner } from 'react-bootstrap';
import { CheckCircle2, Clock, Users, Flame, Calendar, Award } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function Analytics() {
  const { theme } = useTheme();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('week'); // 'week' | 'month' | 'all'

  // Fetch tasks in real-time from Firestore
  useEffect(() => {
    const q = query(collection(db, 'Tasks'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(taskList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching tasks for analytics:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Helper: Extract Date safely from Firestore timestamp
  const getTaskDate = (task) => {
    const timestamp = task.completedAt || task.updatedAt || task.createdAt;
    if (!timestamp) return null;
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp.seconds) {
      return new Date(timestamp.seconds * 1000);
    }
    return new Date(timestamp);
  };

  // Helper: Calculate start of current week (Monday 00:00:00)
  const getStartOfWeek = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(now.setDate(diff));
    start.setHours(0, 0, 0, 0);
    return start;
  };

  // Helper: Calculate start of month
  const getStartOfMonth = () => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return start;
  };

  // Filter tasks based on selected range
  const getFilteredCompletedTasks = () => {
    const doneTasks = tasks.filter(t => t.status === 'done');
    if (timeRange === 'all') return doneTasks;

    const limitDate = timeRange === 'week' ? getStartOfWeek() : getStartOfMonth();
    return doneTasks.filter(task => {
      const date = getTaskDate(task);
      return date && date >= limitDate;
    });
  };

  // Data 1: Tasks Completed by Team Member
  const getTeamCompletionData = () => {
    const filteredTasks = getFilteredCompletedTasks();
    const counts = {};

    filteredTasks.forEach(task => {
      const name = task.completedByName || task.createdByName || 'Unassigned';
      counts[name] = (counts[name] || 0) + 1;
    });

    return Object.keys(counts).map(name => ({
      name: name.split(' ')[0], // First name only to prevent XAxis clutter
      completed: counts[name]
    })).sort((a, b) => b.completed - a.completed);
  };

  // Data 2: Task Status Distribution
  const getStatusDistributionData = () => {
    const counts = { todo: 0, 'in-progress': 0, 'in-review': 0, done: 0 };
    tasks.forEach(t => {
      if (counts[t.status] !== undefined) {
        counts[t.status]++;
      }
    });

    return [
      { name: 'To Do', value: counts.todo, color: '#6c757d' },
      { name: 'In Progress', value: counts['in-progress'], color: '#667eea' },
      { name: 'In Review', value: counts['in-review'], color: '#f5a623' },
      { name: 'Done', value: counts.done, color: '#28a745' }
    ].filter(item => item.value > 0); // Only display states with at least 1 task
  };

  // Data 3: Weekly Completion Velocity (Last 7 Days)
  const getVelocityData = () => {
    const velocity = [];
    const doneTasks = tasks.filter(t => t.status === 'done');

    // Create last 7 days array
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayLabel = d.toLocaleDateString([], { weekday: 'short' });
      const dateString = d.toDateString();

      // Count tasks completed on this specific day
      const count = doneTasks.filter(task => {
        const taskDate = getTaskDate(task);
        return taskDate && taskDate.toDateString() === dateString;
      }).length;

      velocity.push({ day: dayLabel, count });
    }

    return velocity;
  };

  // KPI Calculations
  const totalTasks = tasks.length;
  const activeTasks = tasks.filter(t => t.status !== 'done').length;
  const completedThisWeekCount = tasks.filter(t => {
    if (t.status !== 'done') return false;
    const date = getTaskDate(t);
    return date && date >= getStartOfWeek();
  }).length;
  
  const completionRate = totalTasks > 0 ? Math.round((tasks.filter(t => t.status === 'done').length / totalTasks) * 100) : 0;

  // Top Performer this week
  const getTopPerformer = () => {
    const teamData = getTeamCompletionData();
    return teamData.length > 0 ? teamData[0].name : 'N/A';
  };

  // Custom Chart Tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="p-3 border rounded-3 shadow-lg" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' }}>
          <p className="label fw-bold mb-1 theme-text-primary">{`${label}`}</p>
          <p className="desc mb-0" style={{ color: 'var(--accent)', fontSize: '13px' }}>
            {`${payload[0].name}: ${payload[0].value}`}
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="h-100 d-flex flex-column align-items-center justify-content-center py-5">
        <Spinner animation="border" variant="primary" className="mb-3" />
        <p className="text-muted">Loading analytics data...</p>
      </div>
    );
  }

  const teamData = getTeamCompletionData();
  const statusData = getStatusDistributionData();
  const velocityData = getVelocityData();

  return (
    <div className="pb-5">
      {/* Header & Controls */}
      <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3 mb-4">
        <div>
          <h4 className="fw-bold theme-text-primary mb-1">Analytics Dashboard</h4>
          <p className="text-muted small mb-0">Real-time developer velocity and pipeline telemetry</p>
        </div>
        
        <ButtonGroup className="shadow-sm">
          <Button 
            size="sm" 
            variant={timeRange === 'week' ? 'primary' : 'outline-secondary'}
            onClick={() => setTimeRange('week')}
            className={timeRange === 'week' ? 'border-0' : 'theme-text-primary theme-border'}
            style={{ background: timeRange === 'week' ? 'var(--primary-gradient)' : 'transparent' }}
          >
            This Week
          </Button>
          <Button 
            size="sm" 
            variant={timeRange === 'month' ? 'primary' : 'outline-secondary'}
            onClick={() => setTimeRange('month')}
            className={timeRange === 'month' ? 'border-0' : 'theme-text-primary theme-border'}
            style={{ background: timeRange === 'month' ? 'var(--primary-gradient)' : 'transparent' }}
          >
            This Month
          </Button>
          <Button 
            size="sm" 
            variant={timeRange === 'all' ? 'primary' : 'outline-secondary'}
            onClick={() => setTimeRange('all')}
            className={timeRange === 'all' ? 'border-0' : 'theme-text-primary theme-border'}
            style={{ background: timeRange === 'all' ? 'var(--primary-gradient)' : 'transparent' }}
          >
            All Time
          </Button>
        </ButtonGroup>
      </div>

      {/* KPI Cards Row */}
      <Row className="g-3 mb-4">
        <Col xs={12} sm={6} md={3}>
          <Card className="border-0 rounded-4 shadow-sm h-100" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <Card.Body className="d-flex align-items-center gap-3 p-4">
              <div className="rounded-3 p-3 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(102, 126, 234, 0.1)', color: '#667eea' }}>
                <Clock size={22} />
              </div>
              <div>
                <div className="text-muted small text-uppercase fw-bold" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>Active Tasks</div>
                <h3 className="fw-bold theme-text-primary mb-0 mt-1">{activeTasks}</h3>
              </div>
            </Card.Body>
          </Card>
        </Col>
 
        <Col xs={12} sm={6} md={3}>
          <Card className="border-0 rounded-4 shadow-sm h-100" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <Card.Body className="d-flex align-items-center gap-3 p-4">
              <div className="rounded-3 p-3 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(40, 167, 69, 0.1)', color: '#28a745' }}>
                <CheckCircle2 size={22} />
              </div>
              <div>
                <div className="text-muted small text-uppercase fw-bold" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>Done This Week</div>
                <h3 className="fw-bold theme-text-primary mb-0 mt-1">{completedThisWeekCount}</h3>
              </div>
            </Card.Body>
          </Card>
        </Col>
 
        <Col xs={12} sm={6} md={3}>
          <Card className="border-0 rounded-4 shadow-sm h-100" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <Card.Body className="d-flex align-items-center gap-3 p-4">
              <div className="rounded-3 p-3 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(245, 166, 35, 0.1)', color: '#f5a623' }}>
                <Flame size={22} />
              </div>
              <div>
                <div className="text-muted small text-uppercase fw-bold" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>Completion Rate</div>
                <h3 className="fw-bold theme-text-primary mb-0 mt-1">{completionRate}%</h3>
              </div>
            </Card.Body>
          </Card>
        </Col>
 
        <Col xs={12} sm={6} md={3}>
          <Card className="border-0 rounded-4 shadow-sm h-100" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <Card.Body className="d-flex align-items-center gap-3 p-4">
              <div className="rounded-3 p-3 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                <Award size={22} />
              </div>
              <div>
                <div className="text-muted small text-uppercase fw-bold" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>Top Contributor</div>
                <h3 className="fw-bold theme-text-primary mb-0 mt-1 text-truncate" style={{ maxWidth: '140px' }}>{getTopPerformer()}</h3>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Charts Row 1 */}
      <Row className="g-4 mb-4">
        {/* Bar Chart - Tasks completed */}
        <Col xs={12} lg={8}>
          <Card className="border-0 rounded-4 shadow-sm" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <Card.Body className="p-4">
              <div className="d-flex justify-content-between align-items-center mb-4">
                <h6 className="theme-text-primary fw-bold mb-0 d-flex align-items-center gap-2">
                  <Users size={18} style={{ color: 'var(--accent)' }} />
                  <span>Tasks Completed by Team Members</span>
                </h6>
                <span className="text-muted small">{timeRange === 'week' ? 'Current Week' : timeRange === 'month' ? 'Current Month' : 'All Time'}</span>
              </div>
              
              <div style={{ width: '100%', height: '300px' }}>
                {teamData.length === 0 ? (
                  <div className="h-100 d-flex align-items-center justify-content-center text-muted">
                    No task completions recorded in this range.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={teamData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#667eea" stopOpacity={0.8}/>
                          <stop offset="100%" stopColor="#764ba2" stopOpacity={0.2}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'} vertical={false} />
                      <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} />
                      <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }} />
                      <Bar dataKey="completed" name="Completed Tasks" fill="url(#barGradient)" radius={[6, 6, 0, 0]} barSize={35} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>

        {/* Pie Chart - Task Status Distribution */}
        <Col xs={12} lg={4}>
          <Card className="border-0 rounded-4 shadow-sm h-100" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <Card.Body className="p-4 d-flex flex-column justify-content-between">
              <div>
                <h6 className="theme-text-primary fw-bold mb-4 d-flex align-items-center gap-2">
                  <Flame size={18} style={{ color: '#f5a623' }} />
                  <span>Workload distribution</span>
                </h6>
                
                <div className="d-flex justify-content-center" style={{ width: '100%', height: '200px' }}>
                  {statusData.length === 0 ? (
                    <div className="h-100 d-flex align-items-center justify-content-center text-muted">
                      No active tasks.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={statusData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: theme === 'dark' ? '#1a1a2e' : '#ffffff', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}
                          itemStyle={{ color: 'var(--text-primary)', fontSize: '12px' }}
                          labelStyle={{ display: 'none' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Status Legend */}
              <div className="mt-3">
                <Row className="g-2">
                  {statusData.map((item, index) => (
                    <Col xs={6} key={index}>
                      <div className="d-flex align-items-center gap-2 rounded-3 p-2 theme-bg-secondary theme-border">
                        <div className="rounded-circle" style={{ width: '8px', height: '8px', backgroundColor: item.color }} />
                        <span className="theme-text-primary" style={{ fontSize: '11px' }}>{item.name}: <strong>{item.value}</strong></span>
                      </div>
                    </Col>
                  ))}
                </Row>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Row 2: Daily completion Velocity */}
      <Row>
        <Col xs={12}>
          <Card className="border-0 rounded-4 shadow-sm" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <Card.Body className="p-4">
              <h6 className="theme-text-primary fw-bold mb-4 d-flex align-items-center gap-2">
                <Calendar size={18} style={{ color: '#28a745' }} />
                <span>Daily Velocity (Completed Tasks Last 7 Days)</span>
              </h6>
              
              <div style={{ width: '100%', height: '220px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={velocityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#28a745" stopOpacity={0.4}/>
                        <stop offset="100%" stopColor="#28a745" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'} vertical={false} />
                    <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={11} tickLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="count" name="Tasks Completed" stroke="#28a745" strokeWidth={2.5} fillOpacity={1} fill="url(#areaGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
