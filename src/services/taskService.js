import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDocs,
  getDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

export const taskService = {
  /**
   * Create a new task
   */
  async createTask(taskData) {
    const docRef = await addDoc(collection(db, 'Tasks'), {
      ...taskData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      comments: [],
      activity: [],
      linkedFiles: [],
      mentions: [],
    });

    if (taskData.workspaceId) {
      await this.logTaskActivity(
        taskData.workspaceId,
        taskData.createdBy,
        taskData.createdByName || 'User',
        'task-create',
        'created task',
        taskData.title
      );
    }

    return docRef.id;
  },

  /**
   * Update task details
   */
  async updateTask(taskId, updates) {
    await updateDoc(doc(db, 'Tasks', taskId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  },

  /**
   * Delete a task
   */
  async deleteTask(taskId) {
    // Delete comments first
    const commentsRef = collection(db, 'Tasks', taskId, 'Comments');
    const commentDocs = await getDocs(commentsRef);
    for (const commentDoc of commentDocs.docs) {
      await deleteDoc(commentDoc.ref);
    }
    // Delete activity
    const activityRef = collection(db, 'Tasks', taskId, 'Activity');
    const activityDocs = await getDocs(activityRef);
    for (const activityDoc of activityDocs.docs) {
      await deleteDoc(activityDoc.ref);
    }
    // Delete task
    await deleteDoc(doc(db, 'Tasks', taskId));
  },

  /**
   * Add a comment to a task
   */
  async addComment(taskId, commentData) {
    const docRef = await addDoc(collection(db, 'Tasks', taskId, 'Comments'), {
      ...commentData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      replies: [],
    });
    
    // Add activity log
    await this.addActivityLog(taskId, {
      type: 'comment',
      userId: commentData.createdBy,
      userName: commentData.createdByName,
      description: `Added a comment`,
      relatedCommentId: docRef.id,
    });

    return docRef.id;
  },

  /**
   * Update a comment
   */
  async updateComment(taskId, commentId, updates) {
    await updateDoc(doc(db, 'Tasks', taskId, 'Comments', commentId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  },

  /**
   * Delete a comment
   */
  async deleteComment(taskId, commentId) {
    await deleteDoc(doc(db, 'Tasks', taskId, 'Comments', commentId));
  },

  /**
   * Add activity log entry
   */
  async addActivityLog(taskId, activityData) {
    await addDoc(collection(db, 'Tasks', taskId, 'Activity'), {
      ...activityData,
      createdAt: serverTimestamp(),
    });
  },

  /**
   * Assign task to a user
   */
  async assignTask(taskId, userId, userName, assignerUid, assignerName) {
    const taskRef = doc(db, 'Tasks', taskId);
    const taskSnap = await getDoc(taskRef);
    if (!taskSnap.exists()) return;

    const taskData = taskSnap.data();
    const currentAssignees = taskData.assignedTo || [];
    const workspaceId = taskData.workspaceId || 'global';
    const taskTitle = taskData.title;

    if (!currentAssignees.find(a => a.userId === userId)) {
      await updateDoc(taskRef, {
        assignedTo: arrayUnion({ userId, userName }),
        updatedAt: serverTimestamp(),
      });

      await this.addActivityLog(taskId, {
        type: 'assign',
        userId: userId,
        userName: userName,
        description: `Assigned to ${userName}`,
      });

      await this.logTaskActivity(
        workspaceId,
        assignerUid || userId,
        assignerName || 'User',
        'task-assign',
        `assigned task to ${userName}`,
        taskTitle
      );

      if (window.socket) {
        window.socket.emit('send-notification', {
          roomId: workspaceId,
          notification: {
            message: `${assignerName || 'A member'} assigned task "${taskTitle}" to ${userName}`,
            type: 'task-assign',
            targetUserId: userId,
            assigneeName: userName,
            taskTitle: taskTitle,
            timestamp: Date.now()
          }
        });
      }
    }
  },

  /**
   * Unassign task from a user
   */
  async unassignTask(taskId, userId, userName) {
    await updateDoc(doc(db, 'Tasks', taskId), {
      assignedTo: arrayRemove({ userId, userName }),
      updatedAt: serverTimestamp(),
    });

    await this.addActivityLog(taskId, {
      type: 'unassign',
      userId: userId,
      userName: userName,
      description: `Unassigned from ${userName}`,
    });
  },

  /**
   * Update task status
   */
  async updateTaskStatus(taskId, newStatus, userId, userName) {
    const taskRef = doc(db, 'Tasks', taskId);
    const taskSnap = await getDoc(taskRef);
    if (!taskSnap.exists()) return;

    const taskData = taskSnap.data();
    const workspaceId = taskData.workspaceId || 'global';
    const taskTitle = taskData.title;

    const updates = {
      status: newStatus,
      updatedAt: serverTimestamp(),
    };

    if (newStatus === 'completed') {
      updates.completedAt = serverTimestamp();
      updates.completedBy = userId;
      updates.completedByName = userName;
    } else if (newStatus === 'blocked') {
      updates.blockedAt = serverTimestamp();
      updates.blockedBy = userId;
    }

    await updateDoc(taskRef, updates);

    await this.addActivityLog(taskId, {
      type: 'status_change',
      userId: userId,
      userName: userName,
      description: `Changed status to ${newStatus}`,
      oldStatus: undefined,
      newStatus: newStatus,
    });

    await this.logTaskActivity(
      workspaceId,
      userId,
      userName,
      'task-status',
      `updated task status to ${newStatus}`,
      taskTitle
    );

    if (window.socket) {
      window.socket.emit('send-notification', {
        roomId: workspaceId,
        notification: {
          message: `${userName} updated task "${taskTitle}" status to ${newStatus}`,
          type: 'task-status',
          taskTitle: taskTitle,
          status: newStatus,
          timestamp: Date.now()
        }
      });
    }
  },

  /**
   * Link files to task
   */
  async linkFiles(taskId, files) {
    await updateDoc(doc(db, 'Tasks', taskId), {
      linkedFiles: arrayUnion(...files),
      updatedAt: serverTimestamp(),
    });

    await this.addActivityLog(taskId, {
      type: 'files_linked',
      description: `Linked ${files.length} file(s)`,
    });
  },

  /**
   * Unlink file from task
   */
  async unlinkFile(taskId, fileId) {
    const taskRef = doc(db, 'Tasks', taskId);
    const taskSnap = await getDoc(taskRef);
    const currentFiles = taskSnap.data().linkedFiles || [];
    const fileToRemove = currentFiles.find(f => f.id === fileId);

    if (fileToRemove) {
      await updateDoc(taskRef, {
        linkedFiles: arrayRemove(fileToRemove),
        updatedAt: serverTimestamp(),
      });
    }
  },

  /**
   * Add mention to task
   */
  async addMention(taskId, userId, userName) {
    const taskRef = doc(db, 'Tasks', taskId);
    const taskSnap = await getDoc(taskRef);
    const currentMentions = taskSnap.data().mentions || [];

    if (!currentMentions.find(m => m.userId === userId)) {
      await updateDoc(taskRef, {
        mentions: arrayUnion({ userId, userName, mentionedAt: serverTimestamp() }),
      });
    }
  },

  /**
   * Get task by ID
   */
  async getTask(taskId) {
    const taskSnap = await getDoc(doc(db, 'Tasks', taskId));
    if (taskSnap.exists()) {
      return { id: taskSnap.id, ...taskSnap.data() };
    }
    return null;
  },

  /**
   * Get all comments for a task
   */
  async getTaskComments(taskId) {
    const q = query(collection(db, 'Tasks', taskId, 'Comments'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Get all activity for a task
   */
  async getTaskActivity(taskId) {
    const q = query(collection(db, 'Tasks', taskId, 'Activity'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Get tasks assigned to a user
   */
  async getUserTasks(userId) {
    const q = query(
      collection(db, 'Tasks'),
      where('assignedTo', 'array-contains', { userId })
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Get tasks created by a user
   */
  async getUserCreatedTasks(userId) {
    const q = query(
      collection(db, 'Tasks'),
      where('createdBy', '==', userId)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Get tasks by status
   */
  async getTasksByStatus(status) {
    const q = query(
      collection(db, 'Tasks'),
      where('status', '==', status)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Get tasks by priority
   */
  async getTasksByPriority(priority) {
    const q = query(
      collection(db, 'Tasks'),
      where('priority', '==', priority)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Get overdue tasks
   */
  async getOverdueTasks() {
    const now = new Date();
    const q = query(
      collection(db, 'Tasks'),
      where('deadline', '<', now),
      where('status', 'in', ['todo', 'in-progress', 'review'])
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  /**
   * Get high priority tasks
   */
  async getHighPriorityTasks() {
    const q = query(
      collection(db, 'Tasks'),
      where('priority', '==', 'high'),
      where('status', 'in', ['todo', 'in-progress', 'review'])
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  async logTaskActivity(roomId, userId, userName, action, details, taskTitle) {
    if (!roomId) return;
    try {
      await addDoc(collection(db, 'GitActivity'), {
        workspaceId: roomId,
        userId: userId,
        username: userName,
        repoName: 'workspace-tasks',
        commitMessage: `${userName} ${details}: "${taskTitle}"`,
        actionType: action,
        branchName: '',
        createdAt: serverTimestamp()
      });

      if (window.socket) {
        window.socket.emit('timeline-activity', {
          roomId,
          activity: {
            workspaceId: roomId,
            userId: userId,
            username: userName,
            actionType: action,
            commitMessage: `${userName} ${details}: "${taskTitle}"`,
            createdAt: new Date().toISOString()
          }
        });
      }
    } catch (e) {
      console.error('Error logging task activity:', e);
    }
  },
};

export default taskService;
