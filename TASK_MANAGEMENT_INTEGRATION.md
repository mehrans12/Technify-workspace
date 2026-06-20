# Task Management System - Integration Guide

## Quick Start

### 1. Import Components in Your App

```jsx
import KanbanBoard from './components/KanbanBoard';
import TaskAnalytics from './components/tasks/TaskAnalytics';
```

### 2. Add Routes (if using React Router)

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ... other routes */}
        <Route path="/tasks" element={<KanbanBoard />} />
        <Route path="/analytics" element={<TaskAnalytics />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### 3. Add Navigation Links

```jsx
// In your navigation component
<Nav.Link href="/tasks">📊 Tasks</Nav.Link>
<Nav.Link href="/analytics">📈 Analytics</Nav.Link>
```

## Using Individual Components

### KanbanBoard Component

Already integrated with full task management:

```jsx
import KanbanBoard from './components/KanbanBoard';

export default function TaskPage() {
  return (
    <div>
      <KanbanBoard />
    </div>
  );
}
```

Features included:
- Kanban board with 5 status columns
- Create task modal
- Real-time drag-and-drop
- Task details modal
- Full task editing

### TaskAnalytics Component

Display team productivity and analytics:

```jsx
import TaskAnalytics from './components/tasks/TaskAnalytics';

export default function AnalyticsPage() {
  return (
    <div>
      <TaskAnalytics />
    </div>
  );
}
```

Features included:
- Key metrics (total, completed, in progress, overdue)
- Status and priority charts
- Team productivity table

## Using Task Service Directly

For advanced usage or custom components:

```jsx
import { taskService } from '../services/taskService';
import { useAuth } from '../contexts/AuthContext';

function MyComponent() {
  const { currentUser } = useAuth();

  // Create a task
  const handleCreateTask = async () => {
    try {
      const taskId = await taskService.createTask({
        title: 'My Task',
        description: 'Task description',
        status: 'todo',
        priority: 'high',
        deadline: new Date().toISOString(),
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
      });
      console.log('Task created:', taskId);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Add comment
  const handleAddComment = async (taskId) => {
    try {
      await taskService.addComment(taskId, {
        content: 'My comment',
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName,
      });
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Assign task
  const handleAssign = async (taskId, userId, userName) => {
    try {
      await taskService.assignTask(taskId, userId, userName);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  // Update status
  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await taskService.updateTaskStatus(
        taskId,
        newStatus,
        currentUser.uid,
        currentUser.displayName
      );
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <div>
      <button onClick={handleCreateTask}>Create Task</button>
      {/* Other UI */}
    </div>
  );
}
```

## Using MentionInput Component

For custom comment input with mention support:

```jsx
import MentionInput from './components/tasks/MentionInput';
import { useState } from 'react';

function CustomCommentForm({ teamUsers }) {
  const [content, setContent] = useState('');
  const [mentions, setMentions] = useState([]);

  const handleSubmit = async () => {
    // Save comment with mentions
    console.log('Comment:', content);
    console.log('Mentions:', mentions);
  };

  return (
    <MentionInput
      value={content}
      onChange={setContent}
      placeholder="Type your comment... (@ to mention)"
      teamUsers={teamUsers}
      mentions={mentions}
      onMentionAdd={(user) => setMentions([...mentions, user])}
      onMentionRemove={(user) => 
        setMentions(mentions.filter(m => m.uid !== user.uid))
      }
      rows={3}
    />
  );
}
```

## Integrating with Dashboard

```jsx
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Row, Col, Card } from 'react-bootstrap';

export default function EnhancedDashboard() {
  const { currentUser } = useAuth();
  const [myTasks, setMyTasks] = useState([]);
  const [stats, setStats] = useState({ total: 0, completed: 0 });

  useEffect(() => {
    loadMyTasks();
  }, [currentUser]);

  const loadMyTasks = async () => {
    if (!currentUser?.uid) return;

    try {
      // Get tasks assigned to me
      const q = query(
        collection(db, 'Tasks'),
        where('assignedTo', 'array-contains', { userId: currentUser.uid })
      );
      const snap = await getDocs(q);
      const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyTasks(tasks);

      // Calculate stats
      const completed = tasks.filter(t => t.status === 'completed').length;
      setStats({ total: tasks.length, completed });
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  };

  return (
    <div>
      <h2>My Dashboard</h2>
      
      <Row className="mb-4">
        <Col md={3}>
          <Card>
            <Card.Body>
              <h6>My Tasks</h6>
              <h3>{stats.total}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card>
            <Card.Body>
              <h6>Completed</h6>
              <h3>{stats.completed}</h3>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Quick task list */}
      <h4>My Tasks</h4>
      <div className="list-group">
        {myTasks.slice(0, 5).map(task => (
          <div key={task.id} className="list-group-item">
            <h6>{task.title}</h6>
            <small className={`badge bg-${task.priority === 'high' ? 'danger' : 'info'}`}>
              {task.priority}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Integrating with Sidebar/Navigation

```jsx
import { useState } from 'react';
import { Nav } from 'react-bootstrap';
import { BarChart3, CheckSquare, Users } from 'lucide-react';

export default function TaskNav() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Nav className="flex-column">
      <Nav.Link href="/tasks" className="d-flex align-items-center gap-2">
        <CheckSquare size={20} />
        {!collapsed && 'Task Board'}
      </Nav.Link>
      
      <Nav.Link href="/analytics" className="d-flex align-items-center gap-2">
        <BarChart3 size={20} />
        {!collapsed && 'Analytics'}
      </Nav.Link>
      
      <Nav.Link href="/team" className="d-flex align-items-center gap-2">
        <Users size={20} />
        {!collapsed && 'Team'}
      </Nav.Link>
    </Nav>
  );
}
```

## Advanced: Custom Task Widget

```jsx
import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Card, ProgressBar } from 'react-bootstrap';

export default function TaskWidget() {
  const { currentUser } = useAuth();
  const [highPriorityTasks, setHighPriorityTasks] = useState([]);
  const [overdueTasks, setOverdueTasks] = useState([]);

  useEffect(() => {
    if (!currentUser?.uid) return;

    // Subscribe to high priority tasks
    const highQ = query(
      collection(db, 'Tasks'),
      where('priority', '==', 'high'),
      where('status', 'in', ['todo', 'in-progress'])
    );

    const unsubscribe = onSnapshot(highQ, (snap) => {
      setHighPriorityTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => unsubscribe();
  }, [currentUser]);

  return (
    <Card>
      <Card.Header>
        <Card.Title className="mb-0">🔴 High Priority Tasks</Card.Title>
      </Card.Header>
      <Card.Body>
        {highPriorityTasks.length === 0 ? (
          <p className="text-muted mb-0">No high priority tasks</p>
        ) : (
          <div className="list-group list-group-flush">
            {highPriorityTasks.map(task => (
              <div key={task.id} className="list-group-item">
                <div className="d-flex justify-content-between align-items-start">
                  <h6 className="mb-1">{task.title}</h6>
                  <Badge bg="danger">HIGH</Badge>
                </div>
                <small className="text-muted">
                  Status: {task.status}
                </small>
              </div>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
```

## Styling Customization

All components use CSS variables that can be customized:

```css
/* Override in your global CSS */
:root {
  --primary-color: #667eea;
  --primary-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --success-color: #28a745;
  --danger-color: #dc3545;
  --warning-color: #ffc107;
  --info-color: #0dcaf0;
}
```

## Common Patterns

### Real-time Task Updates

```jsx
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

function TaskList() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'Tasks'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTasks(taskList);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div>
      {tasks.map(task => (
        <div key={task.id}>{task.title}</div>
      ))}
    </div>
  );
}
```

### Filter Tasks by User

```jsx
const userTasks = tasks.filter(t => 
  t.createdBy === currentUser.uid ||
  (t.assignedTo && t.assignedTo.some(a => a.userId === currentUser.uid))
);
```

### Filter Tasks by Status

```jsx
const todoTasks = tasks.filter(t => t.status === 'todo');
const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
const completedTasks = tasks.filter(t => t.status === 'completed');
```

## Performance Tips

1. **Use React.memo** for task cards in long lists
2. **Pagination** for large task lists
3. **Index Firestore queries** on frequently filtered fields
4. **Lazy load** task details and comments
5. **Batch operations** when updating multiple tasks
6. **Debounce** search and filter operations

## Testing

```jsx
// Example test cases
describe('Task Management', () => {
  it('should create a task', async () => {
    const taskId = await taskService.createTask({
      title: 'Test Task',
      status: 'todo',
      priority: 'high'
    });
    expect(taskId).toBeDefined();
  });

  it('should update task status', async () => {
    await taskService.updateTaskStatus(taskId, 'completed', userId, userName);
    const task = await taskService.getTask(taskId);
    expect(task.status).toBe('completed');
  });

  it('should add comment', async () => {
    const commentId = await taskService.addComment(taskId, {
      content: 'Test comment'
    });
    expect(commentId).toBeDefined();
  });
});
```

## Troubleshooting Integration

### Task Board not showing
- Ensure KanbanBoard component is imported correctly
- Check that FireStore is initialized
- Verify user is authenticated
- Check browser console for errors

### Real-time updates not working
- Ensure Firestore rules allow read access
- Check if `onSnapshot` listener is properly set up
- Verify cleanup function removes listener

### Mentions not appearing
- Ensure `teamUsers` state is populated
- Check that user `displayName` is set
- Verify MentionInput component receives correct props

## Next Steps

1. Add email notifications for task mentions
2. Implement task templates
3. Add task dependencies
4. Create custom workflows
5. Add time tracking
6. Implement sprint planning
7. Create burndown charts
