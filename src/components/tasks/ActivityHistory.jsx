import { Alert } from 'react-bootstrap';
import { 
  Clock, 
  Edit2, 
  CheckSquare, 
  AlertCircle, 
  Users, 
  FileText,
  Link as LinkIcon
} from 'lucide-react';
import './ActivityHistory.css';

export default function ActivityHistory({ activity = [], taskId }) {
  const getActivityIcon = (type) => {
    switch(type) {
      case 'status_change': return <CheckSquare size={16} />;
      case 'assign': return <Users size={16} />;
      case 'unassign': return <Users size={16} />;
      case 'priority_change': return <AlertCircle size={16} />;
      case 'comment': return <FileText size={16} />;
      case 'files_linked': return <LinkIcon size={16} />;
      case 'edit': return <Edit2 size={16} />;
      default: return <Clock size={16} />;
    }
  };

  const getActivityColor = (type) => {
    switch(type) {
      case 'status_change': return 'success';
      case 'assign': return 'info';
      case 'unassign': return 'warning';
      case 'priority_change': return 'danger';
      case 'comment': return 'primary';
      case 'files_linked': return 'secondary';
      case 'edit': return 'info';
      default: return 'secondary';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="activity-history">
      {activity && activity.length === 0 ? (
        <Alert variant="info" className="text-center mb-0">
          <Clock className="me-2" />
          No activity yet
        </Alert>
      ) : (
        <div className="timeline">
          {activity.slice().reverse().map((item, idx) => (
            <div key={idx} className="timeline-item">
              <div className="timeline-marker">
                <div className={`icon-badge bg-${getActivityColor(item.type)}`}>
                  {getActivityIcon(item.type)}
                </div>
              </div>
              
              <div className="timeline-content">
                <div className="activity-header d-flex justify-content-between align-items-start">
                  <div>
                    <h6 className="mb-1">
                      {item.userName && (
                        <span className="badge bg-light text-dark me-2">
                          {item.userName}
                        </span>
                      )}
                      {item.description}
                    </h6>
                    <small className="text-muted d-flex align-items-center gap-1">
                      <Clock size={12} />
                      {formatDate(item.createdAt)} at {formatTime(item.createdAt)}
                    </small>
                  </div>
                </div>

                {/* Activity type specific details */}
                {item.type === 'status_change' && (
                  <div className="activity-details mt-2">
                    <span className="badge bg-light text-dark">
                      {item.oldStatus ? `${item.oldStatus} → ` : ''}
                      {item.newStatus}
                    </span>
                  </div>
                )}

                {item.type === 'comment' && (
                  <div className="activity-comment mt-2 p-2 bg-light rounded text-muted small">
                    Comment added on this task
                  </div>
                )}

                {item.type === 'files_linked' && (
                  <div className="activity-details mt-2">
                    <small className="badge bg-light text-dark">
                      📎 {item.description}
                    </small>
                  </div>
                )}
              </div>

              {/* Timeline line (for all except last) */}
              {idx < activity.length - 1 && <div className="timeline-line" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
