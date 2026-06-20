# GitHub Integration - Quick Testing Guide

## Prerequisites
- Node.js installed
- GitHub account
- Firebase project configured
- Server running on `http://localhost:4000`
- Frontend running on `http://localhost:5173`

---

## Test Mode 1: Mock Authentication (No GitHub Setup Required)

### How it works:
If `GITHUB_CLIENT_ID` is not set in `.env`, the system automatically uses mock data.

### To test:
1. Leave `GITHUB_CLIENT_ID` empty in `.env`
2. Start server: `npm run dev` (in `server/` directory)
3. Navigate to Profile page
4. Click "Connect with OAuth"
5. You'll be redirected with mock credentials automatically
6. Mock repositories will appear in the GitHub panel

### Mock Data Includes:
- 3 sample repositories
- Multiple branches per repo
- Sample files in each repo
- Functional UI (repo creation, import, etc.)

---

## Test Mode 2: Personal Access Token (Quick Real Testing)

### Step 1: Create GitHub PAT
1. Go to https://github.com/settings/tokens/new
2. Create token with these scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `read:user` (Read user profile)
3. Copy the generated token

### Step 2: Connect in App
1. Navigate to Profile page
2. Scroll to "Connected Accounts"
3. Select "Option 2: Connect using Personal Access Token"
4. Paste your token
5. Click "Connect with PAT"

### Step 3: Test Operations
Once connected:
- ✅ View your real GitHub repositories
- ✅ Create new repository
- ✅ Import repository into workspace
- ✅ List branches
- ✅ Create branch
- ✅ Commit changes
- ✅ Create and merge pull requests

---

## Test Mode 3: Full OAuth Setup (Production-Ready)

### Step 1: Create GitHub OAuth App
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - App name: `Technify IDE`
   - Homepage: `http://localhost:5173`
   - Callback: `http://localhost:4000/api/github/callback`
4. Copy Client ID and Secret

### Step 2: Update .env
```env
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_REDIRECT_URI=http://localhost:4000/api/github/callback
```

### Step 3: Restart Server
```bash
cd server
npm run dev
```

### Step 4: Test OAuth Flow
1. Navigate to Profile page
2. Click "Connect with OAuth"
3. You'll be redirected to GitHub
4. Click "Authorize" on GitHub's consent screen
5. Auto-redirected to app with connection confirmed

---

## Testing Checklist

### Authentication Tests
- [ ] Mock auth works without setup
- [ ] PAT connection succeeds
- [ ] OAuth flow completes
- [ ] Disconnect works
- [ ] Can reconnect after disconnect

### Repository Tests
- [ ] Can list repositories
- [ ] Can create new repository
- [ ] Can delete repository
- [ ] Can fetch repository details
- [ ] Can import repository into workspace
- [ ] Imported repo appears in editor

### Branch Tests
- [ ] Can list all branches
- [ ] Can create new branch
- [ ] Can switch branches
- [ ] Can delete branch
- [ ] Branch changes reflected in editor

### File Tests
- [ ] Can fetch file tree
- [ ] Can read file contents
- [ ] Can edit files in editor
- [ ] Can commit changes with message
- [ ] Commits appear in git activity

### Pull Request Tests
- [ ] Can list existing PRs
- [ ] Can create new PR
- [ ] Can merge PR
- [ ] PR status updates correctly
- [ ] Merge cleans up branch

### UI Tests
- [ ] GitHub panel loads
- [ ] Repository list displays
- [ ] Search/filter works
- [ ] Loading spinners appear
- [ ] Error messages are helpful
- [ ] Buttons disable when appropriate

### Security Tests
- [ ] Tokens are encrypted in Firestore
- [ ] Tokens never appear in logs
- [ ] Tokens never exposed in console
- [ ] Session tokens expire
- [ ] Cannot access repos without token

### Integration Tests
- [ ] Works with other IDE features
- [ ] AI assistant can see repo code
- [ ] Code execution works on imported files
- [ ] Chat mentions git activity
- [ ] Kanban tasks track with commits

---

## Sample Test Scenarios

### Scenario 1: Import & Edit a Repository
```
1. Connect GitHub (OAuth or PAT)
2. View your repositories in GitHub panel
3. Click "Import" on a repository
4. Code from repo appears in editor
5. Make changes to code
6. Click "Commit" in Git panel
7. Enter commit message
8. Changes pushed to GitHub
9. Git activity logged
```

### Scenario 2: Create Pull Request
```
1. Create new branch "feature-xyz"
2. Make changes in editor
3. Commit with message "Add feature"
4. Click "Create PR"
5. Enter PR title and description
6. Submit PR to GitHub
7. PR appears in list
8. Can merge PR from UI
9. Merge history logged
```

### Scenario 3: Multi-User Collaboration
```
1. User A imports repository
2. User B joins workspace (via invite)
3. Both can see same repository
4. User A makes changes, commits
5. User B sees git activity in real-time
6. User B creates PR from their branch
7. User A reviews and merges
8. Both see updated code in editor
```

---

## Common Test Issues & Solutions

### Issue: "GitHub token validation failed"
**Solution**: 
- Verify token has `repo` scope
- Generate new token with correct scopes
- Check token hasn't expired

### Issue: "Failed to fetch repositories"
**Solution**:
- Check internet connection
- Verify GitHub API isn't rate-limited
- Check server logs for errors
- Verify token in Firestore is encrypted

### Issue: "Cannot create pull request"
**Solution**:
- Ensure different head and base branches
- Verify branch names exist
- Check token has PR permissions
- Review server logs

### Issue: Mock mode not working
**Solution**:
- Verify `GITHUB_CLIENT_ID` is NOT set
- Clear browser cache
- Check server logs for mock auth
- Restart server

---

## Performance Testing

### Load Testing
- List 100+ repositories
- Fetch large file (>10MB)
- Concurrent commits from multiple users
- Real-time sync performance

### Error Recovery
- Test network interruption during commit
- Test token expiration
- Test invalid permissions
- Test GitHub API downtime

---

## Browser DevTools Debugging

### Check Token Encryption
```javascript
// In browser console
db.collection('GitHubConnections').doc(auth.currentUser.uid).get()
  .then(doc => console.log(doc.data().accessToken))
  // Should show: "abc123:def456..." (encrypted format)
```

### Check Git Activity
```javascript
db.collection('GitActivity').where('userId', '==', auth.currentUser.uid)
  .get().then(snap => snap.docs.forEach(d => console.log(d.data())))
```

### Check Repository Connection
```javascript
// roomId = workspace ID
db.collection('RepositoryConnections').doc(roomId).get()
  .then(doc => console.log(doc.data()))
```

---

## Network Debugging

### Monitor GitHub API calls
1. Open DevTools → Network tab
2. Perform GitHub action (create repo, commit, etc.)
3. Filter for `localhost:4000` requests
4. Check:
   - `/api/github/repos` response
   - `/api/github/repos/commit` payload
   - `/api/github/repos/prs/create` response
   - Error status codes

### Monitor WebSocket
1. Open DevTools → Network tab
2. Filter by `WS` protocol
3. See real-time collaboration events
4. Git activity should appear in console

---

## Automated Testing (Future)

```javascript
// Example test case
test('Should create and merge PR', async () => {
  // 1. Connect GitHub
  await connectGitHub(uid, token);
  
  // 2. Import repo
  const repo = await fetchRepos()[0];
  await importRepo(repo);
  
  // 3. Create branch
  const branch = await createBranch('test-feature', 'main');
  
  // 4. Create PR
  const pr = await createPullRequest({
    head: 'test-feature',
    base: 'main',
    title: 'Test PR'
  });
  
  // 5. Merge PR
  const result = await mergePullRequest(pr.number);
  expect(result.merged).toBe(true);
});
```

---

## Reporting Issues

When reporting issues, include:
1. Browser console errors
2. Server logs
3. Network requests (DevTools)
4. Firestore collection state
5. Steps to reproduce
6. Expected vs actual behavior
7. Screenshots/videos if possible

---

## Success Indicators

✅ All tests passing:
- OAuth/PAT authentication working
- Repositories listing correctly
- Commits updating GitHub
- PRs creating and merging
- No token leaks in logs
- Performance acceptable
- Error messages helpful
- UI responsive

---

## Next: Ready for Production

Once all tests pass, the GitHub integration is ready for:
1. Production deployment
2. Real user testing
3. Security audit
4. Performance optimization
5. Advanced features (webhooks, actions, etc.)

---

## Support & Debugging

For help:
1. Check GITHUB_INTEGRATION_SETUP.md
2. Review browser console errors
3. Check server logs: `npm run dev`
4. Verify Firestore data
5. Test with mock mode first
6. Try PAT before OAuth
7. Clear cache and restart browser
