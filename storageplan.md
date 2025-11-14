# Day Tracker - File Version Storage System
## Full Hybrid Storage Implementation Plan

---

## Overview
Build a comprehensive file versioning system that efficiently stores project states over time using **shadow git repositories** for guaranteed version snapshots.

**Core Architecture Decision:**
🔑 **We create our own git repository (shadow repo) for EVERY tracked folder, regardless of whether the user has git.**

**Why Shadow Repos:**
- User might `git reset --hard` → lose session snapshots ❌
- User might force push → history changes ❌
- User might not commit when ending session ❌
- User deletes repo → all sessions lost ❌
- **Shadow repo:** Independent, guaranteed, survives everything ✅

**Storage Strategy:**
- **All folders:** Shadow git repository (our own git clone)
- **Auto-commit:** On every session save
- **Snapshots:** Survive user's git operations
- **Efficiency:** Git compression + smart diffing
- **Session linking:** Build change chains via commit history
- **Smart deduplication:** Detect similar files/projects

---

## Storage Architecture

```
~/Library/Application Support/day-tracker/
├── metadata.db              # SQLite database
├── storage/
│   ├── files/
│   │   └── {hash}/         # Content-addressed file storage (for non-git files)
│   │       └── content
│   └── diffs/
│       └── {session-id}/   # Diff patches
│           └── {file-hash}.patch
└── git-repos/
    └── {folder-hash}/      # Shadow git repositories (one per tracked folder)
        ├── .git/           # Our git repo
        ├── files/          # Snapshot of user's project at each session
        └── metadata.json   # Original path, user's git info, etc.
```

**Example:**
```
User attaches: /Users/zaragoel/projects/day-tracker/
  ↓
We create: ~/Library/.../git-repos/a1b2c3d4/
  ├── .git/                  ← Our shadow git repo
  ├── files/                 ← Copy of their project
  │   ├── src/
  │   ├── package.json
  │   └── ...
  └── metadata.json          ← Stores original path

Each session → New commit in shadow repo
  Commit 1: "Session: Phase 1 storage - Nov 14 2:30 PM"
  Commit 2: "Session: Phase 2 file tracking - Nov 14 5:00 PM"
  Commit 3: "Session: Bug fixes - Nov 15 10:00 AM"
```

---

## Phase 1: Storage Folder Infrastructure
**Goal:** Create local file storage system

**Implementation:**
- Create app storage directory: `~/Library/Application Support/day-tracker/`
- Initialize SQLite database (`metadata.db`)
- Create folder structure: `storage/files/`, `storage/diffs/`, `git-repos/`
- Add Tauri file system permissions for app directory

**Database Schema:**
```sql
CREATE TABLE storage_config (
  id INTEGER PRIMARY KEY,
  storage_path TEXT NOT NULL,
  total_size_bytes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**UI Changes:** None (backend only)

**Success Criteria:**
- Storage directory created on app start
- Database initialized successfully
- No errors on startup

---

## Phase 2: File Metadata Tracking
**Goal:** Track basic file information when attached to sessions

**Implementation:**
- Extend database schema for file metadata
- Calculate SHA-256 hash when file/folder attached
- Store file path, size, modified date, hash
- Link file metadata to session

**Database Schema:**
```sql
CREATE TABLE file_metadata (
  id TEXT PRIMARY KEY,  -- UUID
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,  -- SHA-256
  file_size INTEGER,
  file_type TEXT,  -- 'file' | 'folder' | 'git-repo'
  modified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_file_hash ON file_metadata(file_hash);
CREATE INDEX idx_file_path ON file_metadata(file_path);
CREATE INDEX idx_session_id ON file_metadata(session_id);
```

**UI Changes:**
- Show file hash in session details (for debugging)

**Success Criteria:**
- Files attached to sessions have metadata stored
- Can query files by hash or path

---

## Phase 3: Shadow Git Repository Creation
**Goal:** Create independent git repository for version tracking (even if project already has git)

**Implementation:**
**Key Decision: We ALWAYS create our own shadow git repo, independent of user's git.**

When folder attached:
1. Calculate folder hash (for unique ID)
2. Create shadow repo: `~/Library/.../git-repos/{folder-hash}/`
3. Copy current folder state to shadow repo
4. `git init` in shadow repo
5. Auto-commit: `"Session snapshot: [session-title] - [timestamp]"`
6. Store commit hash in database

**Why Shadow Repos:**
- ✅ Survive user's git operations (reset, rebase, force push)
- ✅ Track uncommitted work
- ✅ Independent of their workflow
- ✅ Auto-commit on every session
- ✅ Guaranteed snapshots

**Database Schema:**
```sql
CREATE TABLE git_shadow_repos (
  id TEXT PRIMARY KEY,  -- UUID
  original_path TEXT NOT NULL,  -- User's original project path
  shadow_repo_path TEXT UNIQUE NOT NULL,  -- Our shadow repo path
  folder_hash TEXT NOT NULL,  -- Hash of folder path for ID
  repo_name TEXT,
  user_has_git BOOLEAN DEFAULT FALSE,  -- Whether user's folder has git
  user_remote_url TEXT,  -- Their git remote (if exists)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_snapshot_at TIMESTAMP
);

CREATE TABLE git_snapshots (
  id TEXT PRIMARY KEY,  -- UUID
  shadow_repo_id TEXT NOT NULL,
  file_metadata_id TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  commit_message TEXT,
  session_id TEXT,
  snapshot_size_bytes INTEGER,
  files_changed INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shadow_repo_id) REFERENCES git_shadow_repos(id),
  FOREIGN KEY (file_metadata_id) REFERENCES file_metadata(id)
);
```

**UI Changes:**
- Badge on file: "📸 Version Tracked" with commit hash
- Show: "Snapshot #5" (how many versions)
- Info: Whether user has git (informational only)

**Success Criteria:**
- Shadow repo created for every folder
- First snapshot committed automatically
- Independent of user's git
- No interference with user's workflow

---

## Phase 4: Smart Snapshot Creation
**Goal:** Efficiently snapshot folder state on session save

**Implementation:**
- On session save, create snapshot in shadow repo
- Smart diffing: Only copy changed files
- Auto-commit with session metadata:
  ```
  Session: "Working on calendar UI"
  Date: 2025-11-14 2:30 PM
  Duration: 2h 15m
  Files changed: 5 (+120, -45)
  ```
- Compress old snapshots (git gc)
- Track which files changed since last snapshot

**Optimization:**
- Use `rsync` for efficient file copying
- Only snapshot if files actually changed
- Git automatically handles compression
- Shallow clones for large repos

**Database Schema:** (no changes, uses Phase 3 schema)

**UI Changes:**
- Progress indicator: "Creating snapshot..." (if large folder)
- After save: "✓ Snapshot created (5 files changed)"
- Option: "Auto-snapshot on session end" (default: ON)

**Success Criteria:**
- Snapshots created in < 2 seconds for small projects
- Only changed files copied
- Storage efficiency > 80% via git compression
- No impact on user's original files

---

## Phase 5: File Similarity Detection
**Goal:** Detect when newly attached file/folder is similar to existing tracked files

**Implementation:**
- When file attached, search database for similar files
- Similarity checks:
  1. Exact path match
  2. Same file name in different path
  3. Same file hash (exact duplicate)
  4. For git repos: Same remote URL
  5. Similar path (Levenshtein distance < 5)
- Return list of candidates with similarity score

**Database Schema:**
```sql
CREATE TABLE file_relationships (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  related_file_id TEXT NOT NULL,
  relationship_type TEXT,  -- 'same-file', 'moved', 'renamed', 'duplicate', 'linked'
  confidence_score REAL,  -- 0.0 to 1.0
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES file_metadata(id),
  FOREIGN KEY (related_file_id) REFERENCES file_metadata(id)
);
```

**New Functions:**
```typescript
interface SimilarFile {
  fileId: string;
  filePath: string;
  fileName: string;
  sessionId: string;
  sessionTitle: string;
  sessionDate: Date;
  similarityScore: number;
  matchReason: 'exact-path' | 'same-name' | 'same-hash' | 'git-remote' | 'similar-path';
}

async function findSimilarFiles(filePath: string, fileHash?: string): Promise<SimilarFile[]>
```

**UI Changes:** None yet (detection only)

**Success Criteria:**
- Similar files detected with accuracy > 80%
- False positives < 10%

---

## Phase 6: Similar File Popup
**Goal:** Show popup suggesting similar files when detected

**Implementation:**
- After file attached, if similar files found, show modal
- Display list of similar files with:
  - Original session title
  - File path
  - Last used date
  - Similarity reason
- Options: "Link to this version", "Create new version", "Cancel"

**Database Schema:** (no changes)

**UI Changes:**
- Modal: "Similar File Detected"
  - Title: "We found a file you've tracked before"
  - List of candidates:
    ```
    📁 ~/projects/day-tracker
    From: "Working on calendar UI" (Nov 14, 2:30 PM)
    Match: Same git repository
    [Link to This] [View Session]
    ```
  - Bottom actions: "None of these" (create new)

**Success Criteria:**
- Popup appears when similar files detected
- User can select which file to link to
- Clear and helpful UI

---

## Phase 7: Manual File Linking
**Goal:** Allow users to manually link files to previous versions

**Implementation:**
- Add "Link to Previous Version" button in file attachment UI
- Show modal with searchable list of all tracked files
- Group by project/folder
- Filter by: Name, Date, Session
- Select file and create link

**Database Schema:**
```sql
CREATE TABLE manual_file_links (
  id TEXT PRIMARY KEY,
  source_file_id TEXT NOT NULL,
  target_file_id TEXT NOT NULL,
  linked_by_user BOOLEAN DEFAULT TRUE,
  link_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_file_id) REFERENCES file_metadata(id),
  FOREIGN KEY (target_file_id) REFERENCES file_metadata(id)
);
```

**UI Changes:**
- Button in file list: "Link to Previous..."
- Modal: "Link File to Previous Version"
  - Search bar
  - List of all tracked files grouped by project
  - Show: Path, Session, Date
  - Action: "Link to This"

**Success Criteria:**
- Can search and find any tracked file
- Link created successfully
- Link shown in session UI

---

## Phase 8: Session-to-Session Linking
**Goal:** Link sessions to build version chains

**Implementation:**
- When linking file, automatically suggest linking entire session
- Store session chain: Session A → Session B → Session C
- Show "Previous Session" and "Next Session" in UI
- Calculate cumulative changes across chain

**Database Schema:**
```sql
ALTER TABLE file_metadata ADD COLUMN previous_version_id TEXT REFERENCES file_metadata(id);
ALTER TABLE file_metadata ADD COLUMN version_chain_id TEXT;  -- Group related versions

CREATE TABLE session_links (
  id TEXT PRIMARY KEY,
  source_session_id TEXT NOT NULL,
  target_session_id TEXT NOT NULL,
  link_type TEXT,  -- 'continuation', 'related', 'branch'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_session_id) REFERENCES sessions(id),
  FOREIGN KEY (target_session_id) REFERENCES sessions(id)
);
```

**UI Changes:**
- In session view, show:
  - "← Previous Session: [title]"
  - "Next Session: [title] →"
- Button: "Continue from this Session" (creates link)

**Success Criteria:**
- Session chains created
- Can navigate between linked sessions
- Chain visualized

---

## Phase 9: Diff Storage for Git
**Goal:** Store and display git diffs between linked sessions

**Implementation:**
- When two git-tracked sessions linked:
  - Calculate diff: `git diff <commit1> <commit2>`
  - Store diff patch
- Display diff in UI:
  - Files changed count
  - Insertions/deletions
  - Expandable file-by-file diff

**Database Schema:**
```sql
CREATE TABLE git_diffs (
  id TEXT PRIMARY KEY,
  from_version_id TEXT NOT NULL,
  to_version_id TEXT NOT NULL,
  diff_patch TEXT,  -- Full diff content
  files_changed INTEGER,
  insertions INTEGER,
  deletions INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_version_id) REFERENCES git_versions(id),
  FOREIGN KEY (to_version_id) REFERENCES git_versions(id)
);
```

**UI Changes:**
- "View Changes" button between linked sessions
- Diff viewer modal:
  - Summary: "5 files changed, +120, -45"
  - File list with diff
  - Syntax highlighting

**Success Criteria:**
- Diffs calculated correctly
- UI shows clear changes
- Large diffs handled (> 1000 files)

---

## Phase 10: Content-Addressed File Storage
**Goal:** Store actual file content efficiently for non-git files

**Implementation:**
- When non-git file attached first time:
  - Calculate SHA-256 hash
  - Copy file to `storage/files/{hash}/content`
  - Store reference in database
- Subsequent attachments of same file:
  - Check if hash exists
  - If yes: Just reference existing file
  - If no: Store new version

**Database Schema:**
```sql
CREATE TABLE file_content (
  hash TEXT PRIMARY KEY,  -- SHA-256
  storage_path TEXT NOT NULL,
  content_size INTEGER,
  compression_type TEXT,  -- 'none', 'gzip', 'brotli'
  first_stored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TIMESTAMP,
  reference_count INTEGER DEFAULT 0
);

CREATE INDEX idx_content_hash ON file_content(hash);
```

**UI Changes:**
- Show storage savings: "5 versions, 1.2 GB saved via deduplication"

**Success Criteria:**
- Duplicate files only stored once
- File retrieval works correctly
- Storage space saved significantly

---

## Phase 11: Binary Diff for Non-Git Files
**Goal:** Store only differences for file changes

**Implementation:**
- When file changes between sessions:
  - Calculate binary diff (using bsdiff or similar)
  - Store diff patch: `storage/diffs/{session-id}/{file-hash}.patch`
- To reconstruct file:
  - Start with base version (content-addressed storage)
  - Apply patches sequentially

**Database Schema:**
```sql
CREATE TABLE file_diffs (
  id TEXT PRIMARY KEY,
  from_file_hash TEXT NOT NULL,
  to_file_hash TEXT NOT NULL,
  diff_path TEXT NOT NULL,
  diff_size INTEGER,
  diff_algorithm TEXT,  -- 'bsdiff', 'xdelta', 'text-diff'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_file_hash) REFERENCES file_content(hash),
  FOREIGN KEY (to_file_hash) REFERENCES file_content(hash)
);
```

**UI Changes:** None (backend optimization)

**Success Criteria:**
- Diffs calculated correctly
- File reconstruction works
- Storage savings > 70% for similar files

---

## Phase 12: Version Viewer
**Goal:** View any file at any point in time

**Implementation:**
- "Open at This Version" button in session
- For git repos: Checkout commit to temp directory
- For files: Reconstruct from diffs
- Open file in default app or in-app viewer
- Read-only mode with warning

**Database Schema:** (no changes)

**UI Changes:**
- Button: "📂 Open Files from This Session"
- Modal showing file browser of that version
- Warning banner: "⚠️ Read-only snapshot from Nov 14, 2:30 PM"
- Actions:
  - "Open in Default App"
  - "Copy to Current Location"
  - "View Diff with Current"

**Success Criteria:**
- Can browse any session's files
- Git checkout works in temp dir
- File reconstruction accurate

---

## Phase 13: Storage Management UI
**Goal:** Manage storage space and cleanup

**Implementation:**
- Storage dashboard showing:
  - Total storage used
  - Breakdown by project
  - Oldest versions
  - Duplicate detection
- Actions:
  - Delete old versions (keep chain)
  - Compact storage
  - Export version history

**Database Schema:**
```sql
CREATE TABLE storage_stats (
  id INTEGER PRIMARY KEY,
  total_files INTEGER,
  total_size_bytes INTEGER,
  git_repos_count INTEGER,
  standalone_files_count INTEGER,
  total_versions INTEGER,
  oldest_version_date TIMESTAMP,
  last_calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**UI Changes:**
- Settings → "Storage Management"
- Pie chart: Storage by project
- Table: Top 10 largest projects
- Actions: "Clean Up", "Export History"

**Success Criteria:**
- Clear storage visibility
- Can free up space safely
- Export works

---

## Phase 14: Smart Cleanup & Retention
**Goal:** Automatically manage storage with policies

**Implementation:**
- Retention policies:
  - Keep all versions from last 30 days
  - Keep 1 version per week for last 6 months
  - Keep 1 version per month after 6 months
- Options:
  - Never delete git commits (just references)
  - Keep files referenced by important sessions
  - Compress old diffs

**Database Schema:**
```sql
CREATE TABLE retention_policies (
  id TEXT PRIMARY KEY,
  policy_name TEXT,
  keep_days_all INTEGER DEFAULT 30,
  keep_weeks INTEGER DEFAULT 26,
  keep_months INTEGER DEFAULT 12,
  never_delete_git BOOLEAN DEFAULT TRUE,
  auto_cleanup BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**UI Changes:**
- Settings → "Storage Policies"
- Sliders for retention periods
- "Auto-Cleanup" toggle
- Dry run: "Preview what would be deleted"

**Success Criteria:**
- Storage stays under control
- Important versions never lost
- Policy enforcement automatic

---

## Phase 15: Cloud Sync for Versions
**Goal:** Backup version metadata to cloud

**Implementation:**
- Extend existing Vercel cloud sync
- Sync file metadata and relationships (not content)
- Enable: "Sync version history to cloud"
- Allows: Access version info from any device

**Database Schema:**
```sql
ALTER TABLE file_metadata ADD COLUMN synced_to_cloud BOOLEAN DEFAULT FALSE;
ALTER TABLE file_metadata ADD COLUMN last_synced_at TIMESTAMP;
```

**API Endpoints (Vercel):**
```
POST /api/versions - Upload version metadata
GET /api/versions?userId=X - Download version metadata
```

**UI Changes:**
- Toggle: "Sync Version History"
- Status: "Last synced: 5 minutes ago"
- Note: "Only metadata synced, not file content"

**Success Criteria:**
- Version history accessible from multiple devices
- Syncs quickly
- No data loss

---

## Phase 16: Collaborative Version Sharing
**Goal:** Share specific file versions with others

**Implementation:**
- "Share This Version" button
- Generate shareable link
- Recipient can:
  - View file (read-only)
  - Download snapshot
  - See diff from their version
- Requires cloud sync enabled

**Database Schema:**
```sql
CREATE TABLE shared_versions (
  id TEXT PRIMARY KEY,
  file_metadata_id TEXT NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  shared_by_user TEXT,
  expires_at TIMESTAMP,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_metadata_id) REFERENCES file_metadata(id)
);
```

**UI Changes:**
- Button: "🔗 Share Version"
- Modal: Generate link with expiry
- Share link format: `https://daytracker.app/v/abc123`

**Success Criteria:**
- Links work in browser
- Recipient can view/download
- Secure and expiring links

---

## Phase 17: Advanced Diff Visualization
**Goal:** Rich diff viewing with code intelligence

**Implementation:**
- Syntax-highlighted diffs
- Side-by-side view
- Inline diff view
- File tree with change indicators
- Search within diffs
- Conflict detection

**Database Schema:** (no changes)

**UI Changes:**
- Full-screen diff viewer
- Monaco editor integration
- Themes: Light, Dark, High Contrast
- Features:
  - Jump to file
  - Expand/collapse unchanged
  - Comment on changes (future)

**Success Criteria:**
- Smooth UX for large diffs
- Accurate syntax highlighting
- Fast rendering

---

## Phase 18: Project Timeline View
**Goal:** Visualize version history over time

**Implementation:**
- Timeline showing all sessions for a project
- Each session = point on timeline
- Show file changes, links, branches
- Interactive: Click to view that version
- Zoom in/out on timeline

**Database Schema:**
```sql
CREATE TABLE project_timelines (
  id TEXT PRIMARY KEY,
  project_name TEXT,
  first_session_date TIMESTAMP,
  last_session_date TIMESTAMP,
  total_sessions INTEGER,
  total_versions INTEGER
);
```

**UI Changes:**
- New view: "Project Timeline"
- Visual timeline (similar to git log --graph)
- Hover: Show session details
- Click: Jump to session

**Success Criteria:**
- Clear visualization of work over time
- Performance with 1000+ sessions
- Helpful for reviewing history

---

## Implementation Priority

**Quick Wins (Implement First):**
1. Phase 1: Storage Folder ⚡
2. Phase 2: File Metadata ⚡
3. Phase 3: Git Detection ⚡
4. Phase 6: Similar File Popup ⚡
5. Phase 4: Auto Git Init ⚡

**Core Features (Next):**
6. Phase 5: Similarity Detection
7. Phase 7: Manual Linking
8. Phase 8: Session Linking
9. Phase 9: Git Diffs
10. Phase 12: Version Viewer

**Advanced (Later):**
11. Phase 10: Content Storage
12. Phase 11: Binary Diffs
13. Phase 13: Storage Management
14. Phase 14: Smart Cleanup
15. Phase 15: Cloud Sync

**Future/Optional:**
16. Phase 16: Collaborative Sharing
17. Phase 17: Advanced Diffs
18. Phase 18: Timeline View

---

## Technical Stack

**Storage:**
- SQLite: Metadata database
- File System: Content-addressed storage
- Git: Native version control for repos

**Libraries:**
- `better-sqlite3`: SQLite for Tauri
- `simple-git`: Git operations from Node
- `bsdiff`/`xdelta`: Binary diffing
- `monaco-editor`: Diff viewer
- `crypto`: SHA-256 hashing

**Tauri Permissions:**
```json
{
  "fs": {
    "scope": [
      "$APPDATA/*",
      "$HOME/Library/Application Support/day-tracker/*"
    ]
  }
}
```

---

## Success Metrics

**Storage Efficiency:**
- Target: < 20% storage vs full copies
- Git repos: < 1% overhead (just hashes)
- Non-git files: < 30% storage (diffs)

**Performance:**
- Attach file: < 500ms
- Similarity detection: < 200ms
- Load version: < 1s
- Diff calculation: < 2s

**User Experience:**
- Similar file detection accuracy: > 85%
- False positives: < 5%
- Zero data loss
- Intuitive linking UI

---

## Next Steps

1. Review this plan
2. Get feedback on priorities
3. Start with Phase 1
4. Implement one phase at a time
5. Test thoroughly before moving to next phase

**Ready to start with Phase 1?**
