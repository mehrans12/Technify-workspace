# GitHub Integration Setup Guide

## Overview
This project includes comprehensive GitHub integration with two authentication methods:
1. **OAuth** - Official GitHub OAuth flow (recommended)
2. **Personal Access Token (PAT)** - For quick testing and CLI workflows

---

## Setup Prerequisites

### 1. Create a GitHub OAuth Application

1. Go to GitHub Settings → Developer settings → [OAuth Apps](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the details:
   - **Application name**: Technify IDE
   - **Homepage URL**: `http://localhost:5173` (or your production domain)
   - **Authorization callback URL**: `http://localhost:4000/api/github/callback`
4. You'll receive:
   - **Client ID**
   - **Client Secret**

### 2. Environment Variables Setup

Create a `.env` file in the project root with:

```env
# GitHub OAuth Configuration
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_REDIRECT_URI=http://localhost:4000/api/github/callback

# Token Encryption (must be exactly 32 characters for AES-256)
ENCRYPTION_KEY=technify_collab_ide_secret_key_32

# OpenRouter API for AI Assistant (optional)
OPENROUTER_API_KEY=your_openrouter_key

# Firebase Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_bucket.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Server Configuration
PORT=4000
VITE_SERVER_URL=http://localhost:4000
VITE_COLLAB_WS_URL=ws://localhost:4000
```

---

## GitHub Integration Features

### Real GitHub Operations

#### 1. **Repository Management**
- ✅ List user repositories (public & private)
- ✅ Create new repositories
- ✅ Delete repositories
- ✅ Get repository details (stats, language, etc.)

#### 2. **Branch Operations**
- ✅ List branches
- ✅ Create new branches
- ✅ Delete branches
- ✅ Switch branches
- ✅ Track active branch

#### 3. **File Operations**
- ✅ Fetch file tree (recursive)
- ✅ Read file contents
- ✅ Commit changes to files
- ✅ Auto-sync changes

#### 4. **Pull Requests** (New!)
- ✅ List pull requests (open/closed/all)
- ✅ Create pull requests
- ✅ Merge pull requests
- ✅ Track PR status

#### 5. **Encryption & Security**
- ✅ AES-256 encryption for access tokens
- ✅ Secure token storage in Firestore
- ✅ Per-request token validation
- ✅ Mock auth fallback for development

---

## API Endpoints

### Authentication
- `GET /api/github/login` - Initiate OAuth flow
- `GET /api/github/callback` - OAuth callback
- `POST /api/github/connect-pat` - Connect via Personal Access Token
- `POST /api/github/disconnect` - Disconnect GitHub account

### Repositories
- `GET /api/github/repos` - List repositories
- `POST /api/github/repos/create` - Create repository
- `GET /api/github/repos/details` - Get repository details
- `POST /api/github/repos/delete` - Delete repository

### Branches
- `GET /api/github/repos/branches` - List branches
- `POST /api/github/repos/branches/create` - Create branch
- `POST /api/github/repos/branches/delete` - Delete branch

### Files & Content
- `GET /api/github/repos/tree` - Get file tree
- `GET /api/github/repos/contents` - Get file contents
- `POST /api/github/repos/commit` - Commit changes

### Pull Requests
- `GET /api/github/repos/prs` - List pull requests
- `POST /api/github/repos/prs/create` - Create pull request
- `POST /api/github/repos/prs/merge` - Merge pull request

---

## Usage Examples

### Frontend: GitHub Service

```javascript
import GitHubService from '@/services/githubService';

// List repositories
const repos = await GitHubService.fetchRepositories(uid, encryptedToken);

// Create a repository
const newRepo = await GitHubService.createRepository(uid, encryptedToken, {
  name: 'my-repo',
  description: 'My awesome project',
  isPrivate: false,
  initReadme: true
});

// Fetch branches
const branches = await GitHubService.fetchBranches(uid, encryptedToken, owner, repo);

// Commit changes
await GitHubService.commitChanges(
  uid, 
  encryptedToken, 
  owner, 
  repo, 
  'main',
  'src/index.js',
  codeContent,
  'feat: add new feature'
);

// Create pull request
await GitHubService.createPullRequest(uid, encryptedToken, owner, repo, {
  title: 'Add new feature',
  body: 'Implements feature X',
  head: 'feature-branch',
  base: 'main'
});

// Merge pull request
await GitHubService.mergePullRequest(uid, encryptedToken, owner, repo, prNumber, 'Merge title', 'Merge message');
```

### Backend: Node.js Server

The server handles:
- Token encryption/decryption
- GitHub API proxy calls
- Firebase Firestore persistence
- Error handling & validation
- Mock auth fallback for development

---

## Authentication Flow

### OAuth Flow (Production)
```
User clicks "Connect with OAuth"
    ↓
Frontend redirects to `/api/github/login`
    ↓
Server redirects to GitHub's auth endpoint
    ↓
GitHub shows consent screen
    ↓
User authorizes → GitHub redirects to `/api/github/callback`
    ↓
Server exchanges code for access token
    ↓
Token encrypted & stored in Firestore
    ↓
Frontend saved with redirect to Profile
    ↓
Connection status updated in real-time
```

### PAT Flow (Quick Testing)
```
User enters Personal Access Token
    ↓
Frontend sends token to `/api/github/connect-pat`
    ↓
Server validates token with GitHub API
    ↓
Token encrypted & stored in Firestore
    ↓
Connection established immediately
```

---

## Creating a Personal Access Token

For quick testing without OAuth setup:

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Click "Generate new token"
3. Name: `Technify IDE`
4. Select scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `read:user` (Read user profile data)
5. Generate and copy the token
6. Use in Profile page: "Connect using Personal Access Token"

---

## Firestore Collections

### GitHubConnections
Stores encrypted access tokens per user:
```javascript
{
  userId: string,
  githubUserId: number,
  githubUsername: string,
  githubAvatarUrl: string,
  accessToken: string, // encrypted
  connectionType: 'oauth' | 'pat',
  connectedAt: timestamp
}
```

### RepositoryConnections
Tracks imported repos per workspace:
```javascript
{
  workspaceId: string,
  userId: string,
  repoName: string,
  repoOwner: string,
  repoUrl: string,
  branchName: string,
  activeFilePath: string,
  originalContent: string,
  autoSyncEnabled: boolean,
  syncInterval: number, // minutes
  autoCommitMessage: string,
  syncedAt: timestamp
}
```

### GitActivity
Logs all git operations:
```javascript
{
  workspaceId: string,
  userId: string,
  username: string,
  repoName: string,
  commitMessage: string,
  actionType: 'clone' | 'commit' | 'push' | 'merge',
  branchName: string,
  createdAt: timestamp
}
```

---

## Error Handling

### Common Issues & Solutions

**Issue**: "GitHub token validation failed"
- **Solution**: Ensure token has `repo` scope. Generate new token if needed.

**Issue**: "Failed to fetch repositories"
- **Solution**: Check network connection. Verify GitHub API isn't rate-limited (60 req/hour for OAuth).

**Issue**: "Repository not connected"
- **Solution**: Import repository from GitHub panel first before making changes.

**Issue**: "Decryption error (might be unencrypted mock token)"
- **Solution**: This is a warning in development. Switch to mock mode if no real token is available.

---

## Development vs. Production

### Development (Mock Mode)
- No GitHub OAuth setup required
- Mock repositories, branches, and files provided
- Useful for UI testing without real GitHub account

### Production (Real GitHub)
- All GitHub OAuth credentials required
- Real GitHub API integration
- Encrypted token storage
- Rate limiting considerations

---

## Security Best Practices

1. **Never commit `.env`** - Add to `.gitignore`
2. **Use strong ENCRYPTION_KEY** - Exactly 32 characters for AES-256
3. **Rotate GITHUB_CLIENT_SECRET** periodically
4. **Use HTTPS in production** - OAuth requires secure redirect URI
5. **Validate tokens** - Always validate PAT before saving
6. **Monitor API usage** - GitHub has rate limits
7. **Log activities** - All git operations are logged to Firestore

---

## Troubleshooting

### Check Server Logs
```bash
cd server
npm run dev
# Look for: [GitHub] messages and error stack traces
```

### Test OAuth Endpoint
```bash
curl "http://localhost:4000/api/github/login?uid=test123&redirect_origin=http://localhost:5173"
```

### Verify Firestore Connection
```javascript
// In browser console
db.collection('GitHubConnections').getDocs()
```

### Mock Auth Testing
- Without `GITHUB_CLIENT_ID` set, system falls back to mock auth
- Useful for testing UI before OAuth setup
- Creates fake repos and file trees for development

---

## Next Steps

1. ✅ Set up GitHub OAuth App
2. ✅ Add environment variables to `.env`
3. ✅ Test OAuth flow in Profile page
4. ✅ Import a repository into workspace
5. ✅ Make changes and commit
6. ✅ Create and merge pull requests
7. ✅ Monitor git activity in Firestore

---

## Support

For issues or questions:
1. Check this guide first
2. Review browser console for errors
3. Check server terminal for logs
4. Verify Firestore rules allow read/write
5. Confirm environment variables are set
