import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Plus, BarChart3, Filter } from 'lucide-react';
import { Button, Form, Modal } from 'react-bootstrap';
import { taskService } from '../services/taskService';
import TaskCard from './tasks/TaskCard';
import TaskDetailsModal from './tasks/TaskDetailsModal';
import './KanbanBoard.css';

const COLUMNS = [
  { id: 'todo', title: 'To Do', color: '#6c757d' },
  { id: 'in-progress', title: 'In Progress', color: '#667eea' },
  { id: 'review', title: 'In Review', color: '#f5a623' },
  { id: 'completed', title: 'Completed', color: '#28a745' },
  { id: 'blocked', title: 'Blocked', color: '#dc3545' },
];

export default function KanbanBoard() {
  const [tasks, setTasks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [roomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || localStorage.getItem('activeRoom') || 'global';
  });
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    status: 'todo',
    priority: 'medium',
    deadline: '',
  });
  const [selectedTask, setSelectedTask] = useState(null);
  const [showTaskDetails, setShowTaskDetails] = useState(false);
  const [teamUsers, setTeamUsers] = useState([]);
  const { currentUser } = useAuth();
  const { theme } = useTheme();

  // Load all users and tasks
  useEffect(() => {
    // Load team users
    const loadTeamUsers = async () => {
      try {
        const q = query(collection(db, 'Users'));
        const querySnapshot = await getDocs(q);
        const users = querySnapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
        setTeamUsers(users);
      } catch (error) {
        console.error('Error loading team users:', error);
      }
    };

    loadTeamUsers();
  }, []);

  // Real-time Firestore listener for Tasks
  useEffect(() => {
    const q = query(collection(db, 'Tasks'), where('workspaceId', '==', roomId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      taskList.sort((a, b) => {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
        return timeA - timeB;
      });
      setTasks(taskList);
    }, (error) => {
      console.error('Error loading tasks for room:', error);
    });
    return () => unsubscribe();
  }, [roomId]);

  // Handle drag end
  async function handleDragEnd(result) {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    try {
      await taskService.updateTaskStatus(
        draggableId,
        destination.droppableId,
        currentUser.uid,
        currentUser.displayName || currentUser.email?.split('@')[0] || 'User'
      );
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  }

  // Add a new task
  async function handleAddTask(e) {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    try {
      await taskService.createTask({
        title: newTask.title.trim(),
        description: newTask.description.trim(),
        status: newTask.status,
        priority: newTask.priority,
        deadline: newTask.deadline ? new Date(newTask.deadline).toISOString() : null,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
        workspaceId: roomId,
      });
      setNewTask({
        title: '',
        description: '',
        status: 'todo',
        priority: 'medium',
        deadline: '',
      });
      setShowModal(false);
    } catch (error) {
      console.error('Error adding task:', error);
      alert('Failed to create task');
    }
  }

  // Get tasks for a specific column
  function getColumnTasks(columnId) {
    return tasks.filter(t => t.status === columnId);
  }

  const handleTaskClick = (task) => {
    setSelectedTask(task);
    setShowTaskDetails(true);
  };

  const handleTaskUpdate = (taskId, updates) => {
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, ...updates } : t)
    );
    if (selectedTask?.id === taskId) {
      setSelectedTask(prev => ({ ...prev, ...updates }));
    }
  };

  const handleTaskDelete = (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setShowTaskDetails(false);
  };

  return (
    <div className="kanban-container">
      {/* Header */}
      <div className="kanban-header">
        <h5 className="kanban-title">📊 Task Management Board</h5>
        <div className="kanban-actions">
          <Button
            size="sm"
            variant="outline-secondary"
            className="d-flex align-items-center gap-2"
            title="View Analytics"
          >
            <BarChart3 size={16} /> Analytics
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="d-flex align-items-center gap-2"
            onClick={() => setShowModal(true)}
          >
            <Plus size={16} /> Add Task
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="kanban-columns">
          {COLUMNS.map(column => (
            <div key={column.id} className="kanban-column">
              {/* Column Header */}
              <div className="column-header" style={{ borderTopColor: column.color }}>
                <div className="column-title-section">
                  <div className="color-dot" style={{ backgroundColor: column.color }} />
                  <h6 className="column-title">{column.title}</h6>
                </div>
                <span className="column-count">{getColumnTasks(column.id).length}</span>
              </div>

              {/* Tasks */}
              <Droppable droppableId={column.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`column-tasks ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                  >
                    {getColumnTasks(column.id).map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`task-wrapper ${snapshot.isDragging ? 'dragging' : ''}`}
                          >
                            <TaskCard
                              task={task}
                              onTaskUpdate={handleTaskUpdate}
                              onTaskDelete={handleTaskDelete}
                              onTaskClick={handleTaskClick}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {getColumnTasks(column.id).length === 0 && (
                      <div className="empty-column">
                        <p>No tasks yet</p>
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {/* Create Task Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)} contentClassName="theme-modal border-secondary" centered>
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined}>
          <Modal.Title>Create New Task</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleAddTask}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label className="fw-bold">Title *</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter task title"
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label className="fw-bold">Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Enter task description (optional)"
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              />
            </Form.Group>

            <div className="row">
              <div className="col-md-6 mb-3">
                <Form.Group>
                  <Form.Label className="fw-bold">Priority</Form.Label>
                  <Form.Select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Form.Select>
                </Form.Group>
              </div>

              <div className="col-md-6 mb-3">
                <Form.Group>
                  <Form.Label className="fw-bold">Status</Form.Label>
                  <Form.Select
                    value={newTask.status}
                    onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                  >
                    {COLUMNS.map(col => (
                      <option key={col.id} value={col.id}>{col.title}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </div>
            </div>

            <Form.Group className="mb-3">
              <Form.Label className="fw-bold">Deadline</Form.Label>
              <Form.Control
                type="date"
                value={newTask.deadline}
                onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
              />
            </Form.Group>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Create Task
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Task Details Modal */}
      <TaskDetailsModal
        show={showTaskDetails}
        task={selectedTask}
        onHide={() => setShowTaskDetails(false)}
        onTaskUpdate={handleTaskUpdate}
        teamUsers={teamUsers}
      />
    </div>
  );
}
