import { useState, useEffect } from 'react';
import { Button, Form, Spinner, Alert } from 'react-bootstrap';
import { Send, Trash2, Edit2, Check, X } from 'lucide-react';
import { taskService } from '../../services/taskService';
import { useAuth } from '../../contexts/AuthContext';
import './CommentsPanel.css';

export default function CommentsPanel({ taskId, comments: initialComments, onCommentAdded, currentUser }) {
  const [comments, setComments] = useState(initialComments || []);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setComments(initialComments || []);
  }, [initialComments]);

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !taskId) return;

    setSubmitting(true);
    try {
      const commentId = await taskService.addComment(taskId, {
        content: newComment,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
      });
      
      setComments(prev => [...prev, {
        id: commentId,
        content: newComment,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
        createdAt: new Date().toISOString(),
        updatedAt: null,
      }]);
      
      setNewComment('');
      if (onCommentAdded) onCommentAdded();
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditComment = async (commentId, oldContent) => {
    if (!editContent.trim()) {
      alert('Comment cannot be empty');
      return;
    }

    setLoading(true);
    try {
      await taskService.updateComment(taskId, commentId, {
        content: editContent,
      });

      setComments(prev => prev.map(c => 
        c.id === commentId ? { ...c, content: editContent } : c
      ));
      setEditingId(null);
      setEditContent('');
    } catch (error) {
      console.error('Error editing comment:', error);
      alert('Failed to edit comment');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) return;

    setLoading(true);
    try {
      await taskService.deleteComment(taskId, commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert('Failed to delete comment');
    } finally {
      setLoading(false);
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
    
    return date.toLocaleDateString();
  };

  return (
    <div className="comments-panel">
      {/* Comments List */}
      <div className="comments-list mb-4">
        {comments.length === 0 ? (
          <Alert variant="info" className="text-center mb-0">
            No comments yet. Be the first to comment!
          </Alert>
        ) : (
          comments.map(comment => (
            <div key={comment.id} className="comment-item">
              <div className="comment-header">
                <div className="d-flex align-items-center gap-2">
                  <div className="comment-avatar">
                    {comment.createdByName?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <strong>{comment.createdByName}</strong>
                    <span className="comment-time ms-2">
                      {formatDate(comment.createdAt)}
                    </span>
                  </div>
                </div>
                
                {currentUser?.uid === comment.createdBy && (
                  <div className="comment-actions">
                    {editingId !== comment.id ? (
                      <>
                        <button
                          className="btn-icon"
                          onClick={() => {
                            setEditingId(comment.id);
                            setEditContent(comment.content);
                          }}
                          title="Edit comment"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn-icon text-danger"
                          onClick={() => handleDeleteComment(comment.id)}
                          title="Delete comment"
                          disabled={loading}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              {editingId === comment.id ? (
                <div className="comment-edit mt-2">
                  <Form.Control
                    as="textarea"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={2}
                    className="mb-2"
                  />
                  <div className="d-flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleEditComment(comment.id, comment.content)}
                      disabled={loading}
                      className="d-flex align-items-center gap-1"
                    >
                      {loading ? <Spinner size="sm" /> : <Check size={14} />}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingId(null);
                        setEditContent('');
                      }}
                      disabled={loading}
                      className="d-flex align-items-center gap-1"
                    >
                      <X size={14} />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="comment-content mt-2">
                  {comment.content}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add Comment Form */}
      <Form onSubmit={handleAddComment} className="comment-form sticky-bottom">
        <Form.Group className="mb-0">
          <Form.Control
            as="textarea"
            rows={2}
            placeholder="Add a comment... (@ to mention)"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="comment-input"
          />
          <div className="d-flex justify-content-end gap-2 mt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setNewComment('')}
              className="d-flex align-items-center gap-1"
            >
              <X size={14} />
              Clear
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={submitting || !newComment.trim()}
              className="d-flex align-items-center gap-1"
            >
              {submitting ? (
                <>
                  <Spinner size="sm" className="me-1" />
                  Posting...
                </>
              ) : (
                <>
                  <Send size={14} />
                  Comment
                </>
              )}
            </Button>
          </div>
        </Form.Group>
      </Form>
    </div>
  );
}
