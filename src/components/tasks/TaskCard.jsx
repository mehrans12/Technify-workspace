import { useState, useEffect } from 'react';
import { Card, Badge, Dropdown, Modal, Form, Button } from 'react-bootstrap';
import { Trash2, Edit2, Clock, AlertCircle, Users, FileText, Paperclip, MoreVertical } from 'lucide-react';
import { taskService } from '../../services/taskService';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import './TaskCard.css';

export default function TaskCard({ task, onTaskUpdate, onTaskDelete, onTaskClick }) {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [teamMembers, setTeamMembers] = useState(task.assignedTo || []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'high': return 'danger';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'secondary';
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'todo': return '#6c757d';
      case 'in-progress': return '#667eea';
      case 'review': return '#f5a623';
      case 'completed': return '#28a745';
      case 'blocked': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const handleDelete = async () => {
    try {
      await taskService.deleteTask(task.id);
      onTaskDelete(task.id);
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const isOverdue = task.deadline && new Date(task.deadline) < new Date() && 
                    !['completed', 'blocked'].includes(task.status);

  return (
    <>
      <Card 
        className="task-card mb-2 cursor-pointer"
        onClick={() => onTaskClick(task)}
        style={{ borderLeft: `4px solid ${getStatusColor(task.status)}` }}
      >
        <Card.Body className="p-3">
          <div className="d-flex justify-content-between align-items-start mb-2">
            <div className="flex-grow-1">
              <Card.Title className="mb-1 task-title">{task.title}</Card.Title>
              <div className="d-flex gap-2 flex-wrap">
                <Badge bg={getPriorityColor(task.priority)}>
                  {task.priority?.toUpperCase()}
                </Badge>
                {isOverdue && (
                  <Badge bg="danger" className="d-flex align-items-center gap-1">
                    <AlertCircle size={12} />
                    Overdue
                  </Badge>
                )}
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              {task.createdBy === currentUser?.uid && (
                <Button
                  variant="link"
                  className="p-0 task-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDeleteConfirm(true);
                  }}
                  title="Delete Task"
                >
                  <Trash2 size={14} />
                </Button>
              )}
              <Dropdown className="task-menu">
                <Dropdown.Toggle variant="link" bsPrefix="p-0" className="dropdown-toggle-custom">
                  <MoreVertical size={16} />
                </Dropdown.Toggle>
                <Dropdown.Menu variant={theme === 'dark' ? 'dark' : undefined}>
                  <Dropdown.Item onClick={(e) => {
                    e.stopPropagation();
                    onTaskClick(task);
                  }}>
                    <Edit2 size={14} className="me-2" /> Edit
                  </Dropdown.Item>
                  <Dropdown.Divider />
                  <Dropdown.Item 
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(true);
                    }}
                    className="text-danger"
                  >
                    <Trash2 size={14} className="me-2" /> Delete
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </div>
          </div>

          {task.description && (
            <p className="task-description text-muted small mb-2">
              {task.description.substring(0, 80)}
              {task.description.length > 80 ? '...' : ''}
            </p>
          )}

          {task.deadline && (
            <div className="mb-2">
              <small className="text-muted d-flex align-items-center gap-1">
                <Clock size={12} />
                {new Date(task.deadline).toLocaleDateString()}
              </small>
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center">
            <div className="d-flex gap-2">
              {task.linkedFiles && task.linkedFiles.length > 0 && (
                <small className="badge bg-light text-dark d-flex align-items-center gap-1">
                  <Paperclip size={12} />
                  {task.linkedFiles.length}
                </small>
              )}
              {task.comments && task.comments.length > 0 && (
                <small className="badge bg-light text-dark d-flex align-items-center gap-1">
                  <FileText size={12} />
                  {task.comments.length}
                </small>
              )}
            </div>
            
            {teamMembers.length > 0 && (
              <div className="task-avatars d-flex">
                {teamMembers.slice(0, 2).map((member, idx) => (
                  <div 
                    key={idx}
                    className="avatar avatar-sm"
                    title={member.userName}
                  >
                    {member.userName.charAt(0).toUpperCase()}
                  </div>
                ))}
                {teamMembers.length > 2 && (
                  <div className="avatar avatar-sm">+{teamMembers.length - 2}</div>
                )}
              </div>
            )}
          </div>
        </Card.Body>
      </Card>

      <Modal show={showDeleteConfirm} onHide={() => setShowDeleteConfirm(false)} contentClassName="theme-modal border-secondary" centered>
        <Modal.Header closeButton closeVariant={theme === 'dark' ? 'white' : undefined}>
          <Modal.Title>Delete Task</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete this task? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
