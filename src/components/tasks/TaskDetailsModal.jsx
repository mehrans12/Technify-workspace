import { useState, useEffect } from 'react';
import { Modal, Form, Button, Tabs, Tab, Badge, Spinner, Alert } from 'react-bootstrap';
import { X, Paperclip, FileText, Users, BarChart3, Clock, AlertCircle, Send, Loader } from 'lucide-react';
import { taskService } from '../../services/taskService';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import CommentsPanel from './CommentsPanel';
import ActivityHistory from './ActivityHistory';
import './TaskDetailsModal.css';

const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['todo', 'in-progress', 'review', 'completed', 'blocked'];

export default function TaskDetailsModal({ show, task, onHide, onTaskUpdate, teamUsers = [] }) {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({});
  const [comments, setComments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || '',
        description: task.description || '',
        status: task.status || 'todo',
        priority: task.priority || 'medium',
        deadline: task.deadline ? new Date(task.deadline).toISOString().split('T')[0] : '',
        assignedTo: task.assignedTo || [],
      });
      loadCommentsAndActivity();
    }
  }, [task]);

  const loadCommentsAndActivity = async () => {
    if (!task?.id) return;
    try {
      const [commentsData, activityData] = await Promise.all([
        taskService.getTaskComments(task.id),
        taskService.getTaskActivity(task.id),
      ]);
      setComments(commentsData);
      setActivity(activityData);
    } catch (error) {
      console.error('Error loading task data:', error);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveTask = async () => {
    if (!formData.title.trim()) {
      alert('Task title is required');
      return;
    }

    setLoading(true);
    try {
      const updates = { ...formData };
      if (formData.deadline) {
        updates.deadline = new Date(formData.deadline).toISOString();
      }
      
      await taskService.updateTask(task.id, updates);
      onTaskUpdate(task.id, updates);
      loadCommentsAndActivity();
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Failed to update task');
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    try {
      await taskService.addComment(task.id, {
        content: newComment,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
      });
      setNewComment('');
      loadCommentsAndActivity();
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleAssignUser = async (userId, userName) => {
    try {
      const assignerName = currentUser.displayName || currentUser.email?.split('@')[0] || 'User';
      await taskService.assignTask(task.id, userId, userName, currentUser.uid, assignerName);
      setFormData(prev => ({
        ...prev,
        assignedTo: [...(prev.assignedTo || []), { userId, userName }]
      }));
      loadCommentsAndActivity();
    } catch (error) {
      console.error('Error assigning task:', error);
    }
  };

  const handleUnassignUser = async (userId, userName) => {
    try {
      await taskService.unassignTask(task.id, userId, userName);
      setFormData(prev => ({
        ...prev,
        assignedTo: (prev.assignedTo || []).filter(a => a.userId !== userId)
      }));
      loadCommentsAndActivity();
    } catch (error) {
      console.error('Error unassigning task:', error);
    }
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'high': return 'danger';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'secondary';
    }
  };

  const isOverdue = formData.deadline && new Date(formData.deadline) < new Date() && 
                    !['completed', 'blocked'].includes(formData.status);

  return (
    <Modal show={show} onHide={onHide} size="lg" className="task-details-modal" contentClassName="theme-modal border-secondary">
      <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined} className="task-modal-header">
        <Modal.Title className="fw-bold">Task Details</Modal.Title>
      </Modal.Header>

      <Modal.Body className="task-modal-body">
        <Tabs defaultActiveKey="details" className="task-tabs">
          
          {/* Details Tab */}
          <Tab eventKey="details" title="Details" className="p-3">
            <Form className="task-form">
              {/* Title */}
              <Form.Group className="mb-3">
                <Form.Label className="fw-bold">Title *</Form.Label>
                <Form.Control
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleFormChange}
                  placeholder="Enter task title"
                  className="form-control-lg"
                />
              </Form.Group>

              {/* Description */}
              <Form.Group className="mb-3">
                <Form.Label className="fw-bold">Description</Form.Label>
                <Form.Control
                  as="textarea"
                  name="description"
                  value={formData.description}
                  onChange={handleFormChange}
                  placeholder="Enter task description"
                  rows={4}
                />
              </Form.Group>

              <div className="row">
                {/* Status */}
                <div className="col-md-6 mb-3">
                  <Form.Group>
                    <Form.Label className="fw-bold">Status</Form.Label>
                    <Form.Select
                      name="status"
                      value={formData.status}
                      onChange={handleFormChange}
                    >
                      {STATUSES.map(s => (
                        <option key={s} value={s}>
                          {s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>

                {/* Priority */}
                <div className="col-md-6 mb-3">
                  <Form.Group>
                    <Form.Label className="fw-bold">Priority</Form.Label>
                    <Form.Select
                      name="priority"
                      value={formData.priority}
                      onChange={handleFormChange}
                    >
                      {PRIORITIES.map(p => (
                        <option key={p} value={p}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
              </div>

              {/* Deadline */}
              <Form.Group className="mb-3">
                <Form.Label className="fw-bold">Deadline</Form.Label>
                <Form.Control
                  type="date"
                  name="deadline"
                  value={formData.deadline}
                  onChange={handleFormChange}
                />
                {isOverdue && (
                  <Alert variant="danger" className="mt-2 mb-0 d-flex align-items-center gap-2">
                    <AlertCircle size={16} />
                    This task is overdue
                  </Alert>
                )}
              </Form.Group>

              {/* Assigned To */}
              <Form.Group className="mb-3">
                <Form.Label className="fw-bold d-flex align-items-center gap-2">
                  <Users size={16} />
                  Assigned To
                </Form.Label>
                <div className="assigned-users mb-2">
                  {formData.assignedTo && formData.assignedTo.map((assignee, idx) => (
                    <Badge 
                      key={idx}
                      bg="primary"
                      className="me-2 mb-2 d-inline-flex align-items-center gap-2 ps-2 pe-2 py-2"
                    >
                      {assignee.userName}
                      <X 
                        size={14}
                        className="cursor-pointer"
                        onClick={() => handleUnassignUser(assignee.userId, assignee.userName)}
                      />
                    </Badge>
                  ))}
                </div>
                <Form.Select 
                  size="sm"
                  onChange={(e) => {
                    if (e.target.value) {
                      const selected = teamUsers.find(u => u.uid === e.target.value);
                      if (selected) {
                        handleAssignUser(selected.uid, selected.displayName);
                      }
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">+ Assign user...</option>
                  {teamUsers.map(user => (
                    <option key={user.uid} value={user.uid}>
                      {user.displayName} ({user.email})
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Form>

            <div className="d-grid gap-2 mt-4">
              <Button 
                variant="primary" 
                onClick={handleSaveTask}
                disabled={loading}
                className="btn-lg"
              >
                {loading ? <>
                  <Loader size={16} className="me-2 spinner-border spinner-border-sm" />
                  Saving...
                </> : 'Save Changes'}
              </Button>
            </div>
          </Tab>

          {/* Comments Tab */}
          <Tab eventKey="comments" title={`Comments (${comments.length})`} className="p-3">
            <CommentsPanel 
              taskId={task?.id}
              comments={comments}
              onCommentAdded={loadCommentsAndActivity}
              currentUser={currentUser}
            />
          </Tab>

          {/* Activity Tab */}
          <Tab eventKey="activity" title={`Activity (${activity.length})`} className="p-3">
            <ActivityHistory 
              activity={activity}
              taskId={task?.id}
            />
          </Tab>

          {/* Files Tab */}
          <Tab eventKey="files" title={`Files (${formData.linkedFiles?.length || 0})`} className="p-3">
            <div className="linked-files">
              {formData.linkedFiles && formData.linkedFiles.length > 0 ? (
                <div className="list-group">
                  {formData.linkedFiles.map((file, idx) => (
                    <div key={idx} className="list-group-item d-flex justify-content-between align-items-center">
                      <div className="d-flex align-items-center gap-2">
                        <FileText size={16} className="text-primary" />
                        <div>
                          <div className="fw-bold">{file.name}</div>
                          <small className="text-muted">{file.path}</small>
                        </div>
                      </div>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={async () => {
                          await taskService.unlinkFile(task.id, file.id);
                          setFormData(prev => ({
                            ...prev,
                            linkedFiles: prev.linkedFiles.filter(f => f.id !== file.id)
                          }));
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Alert variant="info" className="text-center">
                  <FileText className="me-2" />
                  No files linked to this task
                </Alert>
              )}
            </div>
          </Tab>

        </Tabs>
      </Modal.Body>
    </Modal>
  );
}
