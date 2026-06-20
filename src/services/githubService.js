/**
 * GitHub Service - Handles all GitHub API interactions
 * Manages authentication, repos, branches, commits, PRs, and more
 */

const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

class GitHubService {
  /**
   * Start OAuth Login Flow
   */
  static initiateOAuthLogin(uid) {
    const redirectOrigin = window.location.origin;
    window.location.href = `${API_BASE}/api/github/login?uid=${uid}&redirect_origin=${encodeURIComponent(redirectOrigin)}`;
  }

  /**
   * Connect via Personal Access Token
   */
  static async connectWithPAT(uid, token) {
    try {
      const response = await fetch(`${API_BASE}/api/github/connect-pat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, token })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to connect GitHub');
      }

      return await response.json();
    } catch (error) {
      console.error('GitHub PAT Connection Error:', error);
      throw error;
    }
  }

  /**
   * Disconnect GitHub Account
   */
  static async disconnect(uid) {
    try {
      console.log('[GitHubService] Disconnect: Sending request to', `${API_BASE}/api/github/disconnect`, 'with uid:', uid);
      const response = await fetch(`${API_BASE}/api/github/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid })
      });

      console.log('[GitHubService] Disconnect response status:', response.status);
      
      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        console.error('[GitHubService] Failed to parse response JSON:', parseErr);
        data = { error: 'Invalid server response' };
      }
      
      console.log('[GitHubService] Disconnect response data:', data);

      if (!response.ok) {
        const errorMsg = data.error || `HTTP ${response.status}`;
        throw new Error(errorMsg);
      }
      return data;
    } catch (error) {
      console.error('[GitHubService] Disconnect Error:', error);
      throw error;
    }
  }

  /**
   * Fetch User Repositories
   */
  static async fetchRepositories(uid, encryptedToken) {
    try {
      const headers = {};
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/repos?uid=${uid}`, { headers });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch repositories');
      }

      return await response.json();
    } catch (error) {
      console.error('Fetch Repositories Error:', error);
      throw error;
    }
  }

  /**
   * Create a New Repository
   */
  static async createRepository(uid, encryptedToken, repoData) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/create-repo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid,
          name: repoData.name,
          description: repoData.description,
          isPrivate: repoData.isPrivate,
          private: repoData.isPrivate,
          initReadme: repoData.initReadme !== undefined ? repoData.initReadme : true
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create repository');
      }

      return await response.json();
    } catch (error) {
      console.error('Create Repository Error:', error);
      throw error;
    }
  }

  /**
   * Fetch Repository Branches
   */
  static async fetchBranches(uid, encryptedToken, owner, repo, roomId) {
    try {
      const headers = {};
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(
        `${API_BASE}/api/github/repos/branches?uid=${uid}&owner=${owner || ''}&repo=${repo || ''}&roomId=${roomId || ''}`,
        { headers }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch branches');
      }

      return await response.json();
    } catch (error) {
      console.error('Fetch Branches Error:', error);
      throw error;
    }
  }

  /**
   * Create New Branch
   */
  static async createBranch(uid, encryptedToken, owner, repo, branchName, fromBranch = 'main', roomId) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/repos/branches/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid,
          owner,
          repo,
          branchName,
          fromBranch,
          roomId
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create branch');
      }

      return await response.json();
    } catch (error) {
      console.error('Create Branch Error:', error);
      throw error;
    }
  }

  /**
   * Delete Branch
   */
  static async deleteBranch(uid, encryptedToken, owner, repo, branchName) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/repos/branches/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid,
          owner,
          repo,
          branchName
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete branch');
      }

      return await response.json();
    } catch (error) {
      console.error('Delete Branch Error:', error);
      throw error;
    }
  }

  /**
   * Fetch Repository File Tree
   */
  static async fetchFileTree(uid, encryptedToken, owner, repo, branch, roomId) {
    try {
      const headers = {};
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(
        `${API_BASE}/api/github/repos/tree?uid=${uid}&owner=${owner}&repo=${repo}&branch=${branch}&roomId=${roomId || ''}`,
        { headers }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch file tree');
      }

      return await response.json();
    } catch (error) {
      console.error('Fetch File Tree Error:', error);
      throw error;
    }
  }

  /**
   * Fetch File Content
   */
  static async fetchFileContent(uid, encryptedToken, owner, repo, path, branch, roomId) {
    try {
      const headers = {};
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(
        `${API_BASE}/api/github/repos/contents?uid=${uid}&owner=${owner}&repo=${repo}&branch=${branch}&path=${encodeURIComponent(path)}&roomId=${roomId || ''}`,
        { headers }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch file content');
      }

      const data = await response.json();
      // Decode base64 content
      if (data.content) {
        try {
          const binary = atob(data.content.replace(/\s/g, ''));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          data.decodedContent = new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
          data.decodedContent = data.content;
        }
      }
      return data;
    } catch (error) {
      console.error('Fetch File Content Error:', error);
      throw error;
    }
  }

  /**
   * Commit Changes to Repository
   */
  static async commitChanges(uid, encryptedToken, owner, repo, branch, path, content, commitMessage, roomId) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/commit`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid,
          owner,
          repo,
          branch,
          path,
          content,
          commitMessage,
          roomId
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to commit changes');
      }

      return await response.json();
    } catch (error) {
      console.error('Commit Changes Error:', error);
      throw error;
    }
  }

  /**
   * Fetch Pull Requests
   */
  static async fetchPullRequests(uid, encryptedToken, owner, repo, state = 'open') {
    try {
      const headers = {};
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(
        `${API_BASE}/api/github/repos/prs?uid=${uid}&owner=${owner}&repo=${repo}&state=${state}`,
        { headers }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch pull requests');
      }

      return await response.json();
    } catch (error) {
      console.error('Fetch PRs Error:', error);
      throw error;
    }
  }

  /**
   * Create Pull Request
   */
  static async createPullRequest(uid, encryptedToken, owner, repo, prData) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/repos/prs/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid,
          owner,
          repo,
          title: prData.title,
          body: prData.body,
          head: prData.head,
          base: prData.base
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create pull request');
      }

      return await response.json();
    } catch (error) {
      console.error('Create PR Error:', error);
      throw error;
    }
  }

  /**
   * Merge Pull Request
   */
  static async mergePullRequest(uid, encryptedToken, owner, repo, prNumber, commitTitle, commitMessage) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/repos/prs/merge`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid,
          owner,
          repo,
          prNumber,
          commitTitle,
          commitMessage
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to merge pull request');
      }

      return await response.json();
    } catch (error) {
      console.error('Merge PR Error:', error);
      throw error;
    }
  }

  /**
   * Delete Repository
   */
  static async deleteRepository(uid, encryptedToken, owner, repo) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/repos/delete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid,
          owner,
          repo
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete repository');
      }

      return await response.json();
    } catch (error) {
      console.error('Delete Repository Error:', error);
      throw error;
    }
  }

  /**
   * Get Repository Details
   */
  static async getRepositoryDetails(uid, encryptedToken, owner, repo) {
    try {
      const headers = {};
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(
        `${API_BASE}/api/github/repos/details?uid=${uid}&owner=${owner}&repo=${repo}`,
        { headers }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch repository details');
      }

      return await response.json();
    } catch (error) {
      console.error('Fetch Repo Details Error:', error);
      throw error;
    }
  }

  /**
   * Git Init locally in workspace
   */
  static async gitInit(uid, roomId) {
    try {
      const response = await fetch(`${API_BASE}/api/github/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, roomId })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to initialize local repository');
      }
      return await response.json();
    } catch (error) {
      console.error('Git Init Error:', error);
      throw error;
    }
  }

  /**
   * Git Remote Add origin locally in workspace
   */
  static async gitRemoteAdd(uid, encryptedToken, roomId, remoteUrl) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/remote-add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uid, roomId, remoteUrl })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add remote origin');
      }
      return await response.json();
    } catch (error) {
      console.error('Git Remote Add Error:', error);
      throw error;
    }
  }

  /**
   * Git Clone repo locally in workspace
   */
  static async gitClone(uid, encryptedToken, roomId, owner, repo, branch) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/clone`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uid, roomId, owner, repo, branch })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to clone repository');
      }
      return await response.json();
    } catch (error) {
      console.error('Git Clone Error:', error);
      throw error;
    }
  }

  /**
   * Git Push locally committed changes to GitHub remote
   */
  static async gitPush(uid, encryptedToken, roomId, branch) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uid, roomId, branch })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to push changes');
      }
      return await response.json();
    } catch (error) {
      console.error('Git Push Error:', error);
      throw error;
    }
  }

  /**
   * Git Pull changes from GitHub remote into local workspace
   */
  static async gitPull(uid, encryptedToken, roomId, branch, activeFilePath) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/pull`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uid, roomId, branch, activeFilePath })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to pull changes');
      }
      return await response.json();
    } catch (error) {
      console.error('Git Pull Error:', error);
      throw error;
    }
  }

  /**
   * Switch local branch
   */
  static async switchLocalBranch(uid, encryptedToken, roomId, branchName, activeFilePath) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (encryptedToken) {
        headers['x-github-token'] = encryptedToken;
      }

      const response = await fetch(`${API_BASE}/api/github/branches/switch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ uid, roomId, branchName, activeFilePath })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to switch branch');
      }
      return await response.json();
    } catch (error) {
      console.error('Switch Local Branch Error:', error);
      throw error;
    }
  }

  /**
   * Get local Git status of the workspace
   */
  static async gitStatus(uid, roomId) {
    try {
      const response = await fetch(`${API_BASE}/api/github/status?uid=${uid}&roomId=${roomId || ''}`);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch local Git status');
      }
      return await response.json();
    } catch (error) {
      console.error('Git Status Error:', error);
      throw error;
    }
  }
}

export default GitHubService;
