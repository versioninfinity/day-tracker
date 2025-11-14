# Phase 2 Testing Guide: File Metadata Tracking

## What Was Implemented

✅ File metadata database table with indexes
✅ File hashing service (SHA-256 for files and directories)
✅ Storage service file tracking methods
✅ Session ID generation and tracking
✅ UI integration for file attachment
✅ File hash display in UI

## How to Test

### 1. Check Browser Console for Storage Logs

The app should be running now. In the Tauri app window:
1. Right-click anywhere → **Inspect Element** (or press `Cmd+Option+I`)
2. Click on the **Console** tab
3. Look for Phase 1 initialization messages (from previous phase):

```
✅ Storage infrastructure initialized successfully!
```

### 2. Create a Session with File Attachments

#### Test: Attach a Single File

1. **Create a new session:**
   - Drag to create a time slot on the calendar
   - Give it a title like "Test File Tracking"

2. **Attach a file:**
   - Click "Add Files" button
   - Select any file (e.g., a text file or image)
   - Watch the console for these logs:

```
📎 Tracking file: /path/to/your/file.txt
  ✓ Hash calculated: a1b2c3d4e5f6...
  ✓ File tracked with ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
✅ Tracked file: file.txt (a1b2c3d4e5f6...)
```

3. **Verify in UI:**
   - The file should appear in the file list
   - You should see a green badge "✓ Tracked" next to the filename
   - Below the path, you should see:
     ```
     Hash: a1b2c3d4e5f6...
     ```

4. **Save the session** and verify it appears on the calendar

#### Test: Attach a Folder

1. **Create another session** or edit the existing one
2. **Click "Add Folder"** button
3. **Select a folder** (preferably a small one for faster hashing)
4. **Watch the console** for folder tracking logs:

```
📎 Tracking file: /path/to/your/folder
  ✓ Hash calculated: 7f8e9d0c1b2a...
  ✓ File tracked with ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
✅ Tracked folder: folder (7f8e9d0c1b2a...)
```

5. **Verify the folder** shows "✓ Tracked" badge

#### Test: Attach Multiple Files

1. **Click "Add Files"** again
2. **Select multiple files** (hold Cmd while clicking)
3. **Each file should be tracked individually**
4. **Console should show tracking logs for each file**

### 3. Verify Database Storage

Open a terminal and query the database:

```bash
sqlite3 ~/Library/Application\ Support/day-tracker-temp/metadata.db
```

**Check file_metadata table:**

```sql
-- View all tracked files
SELECT id, session_id, file_name, file_type,
       substr(file_hash, 1, 16) as hash_preview,
       file_size
FROM file_metadata;
```

**Expected output:**

```
id                                    |session_id                            |file_name      |file_type|hash_preview     |file_size
--------------------------------------|--------------------------------------|---------------|---------|-----------------|----------
uuid-here...                          |session-uuid-here...                  |file.txt       |file     |a1b2c3d4e5f6     |1024
uuid-here...                          |session-uuid-here...                  |folder         |folder   |7f8e9d0c1b2a     |524288
```

**Check indexes exist:**

```sql
-- List all indexes on file_metadata
.indexes file_metadata
```

**Expected output:**

```
idx_file_hash
idx_file_path
idx_session_id
```

**Query files by hash:**

```sql
-- Find duplicate files (same hash)
SELECT file_hash, COUNT(*) as count, GROUP_CONCAT(file_name) as files
FROM file_metadata
WHERE file_hash IS NOT NULL
GROUP BY file_hash
HAVING COUNT(*) > 1;
```

**Query files for a specific session:**

```sql
-- Get all files for a session (replace with actual session_id)
SELECT file_name, file_type, file_path, substr(file_hash, 1, 16) as hash
FROM file_metadata
WHERE session_id = 'your-session-id-here';
```

### 4. Test Session Persistence

1. **Create a session with files**
2. **Close the app** (Cmd+Q)
3. **Reopen the app**
4. **Click on the session** to edit it
5. **Verify:**
   - All files are still attached
   - "✓ Tracked" badges are shown
   - Hash values are displayed
   - Files can still be opened

### 5. Test File Hash Calculations

#### Small File Test

1. **Create a text file:**
   ```bash
   echo "Hello World" > ~/Desktop/test.txt
   ```

2. **Calculate hash manually:**
   ```bash
   shasum -a 256 ~/Desktop/test.txt
   ```
   Note the hash value.

3. **Attach the file** to a session in the app
4. **Compare the hash** shown in the UI with the manual calculation
   - They should match!

#### Folder Test

1. **Attach a folder** with several files
2. **Watch the console** - you should see hash calculations for each file
3. **The folder's hash** is a combined hash of all files inside

### 6. Test Error Handling

#### Test: Large File/Folder

1. **Try attaching a very large folder** (like your entire home directory)
2. **It may take a while** - the console should show:
   ```
   📎 Tracking file: /Users/...
   ```
3. **It should complete** without crashing

#### Test: Permission Denied

1. **Try attaching a system folder** like `/private/var/root`
2. **Should see a warning** in console:
   ```
   ⚠️  Could not hash file (will track without hash)
   ```
3. **File should still be added** but without a hash

#### Test: Non-existent File

This shouldn't happen through the UI, but the storage service handles it gracefully.

### 7. Visual Confirmation

When viewing a session with attached files, you should see:

```
┌─────────────────────────────────────────────────────┐
│ ✓ Tracked  file.txt                                 │
│ /Users/zaragoel/Desktop/file.txt                    │
│ 1.5 KB                                              │
│ Hash: a1b2c3d4e5f6...                               │
│                                         [Open]  [×] │
└─────────────────────────────────────────────────────┘
```

## Success Criteria

✅ **Database Integration:**
- [ ] Files tracked in `file_metadata` table
- [ ] Session IDs properly linked
- [ ] Hashes calculated and stored
- [ ] Indexes working (query performance is good)

✅ **UI Features:**
- [ ] "✓ Tracked" badge appears for tracked files
- [ ] File hash displayed (first 16 characters)
- [ ] Files and folders can be attached
- [ ] Multiple files can be attached
- [ ] Files persist across app restarts

✅ **Console Logs:**
- [ ] File tracking logs appear when attaching files
- [ ] Hash calculation logs show progress
- [ ] No errors in console

✅ **Hash Accuracy:**
- [ ] File hashes match manual SHA-256 calculation
- [ ] Same file attached twice has same hash
- [ ] Folder hash is deterministic (same folder = same hash)

## Troubleshooting

**Problem: No "✓ Tracked" badge appears**
- Check console for tracking errors
- Verify `storageService.trackFile()` is being called
- Check database table exists: `SELECT * FROM file_metadata LIMIT 1;`

**Problem: Hash not displayed**
- File might not have read permissions
- Check console for hash calculation warnings
- Verify file exists at the path shown

**Problem: Folder hashing is slow**
- Large folders with many files take time
- This is expected - hashing is comprehensive
- Watch console for progress logs

**Problem: Database errors**
- Verify Phase 1 completed successfully
- Check `metadata.db` file exists
- Verify SQL permissions in `capabilities/default.json`

## Testing Checklist

Use this to systematically test all features:

- [ ] Attach single file to session
- [ ] Attach multiple files to session
- [ ] Attach folder to session
- [ ] Verify "✓ Tracked" badge appears
- [ ] Verify hash displayed in UI
- [ ] Check console for tracking logs
- [ ] Query database to verify storage
- [ ] Restart app and verify files persist
- [ ] Move session, verify files remain attached
- [ ] Edit session, verify files remain attached
- [ ] Delete and re-add file, verify new hash calculated
- [ ] Attach same file twice, verify hashes match

## What's Different from Phase 1

**Phase 1:** Created infrastructure (folders, database, storage_config table)
**Phase 2:** Actually tracks files with metadata and content hashes

**New Tables:**
- `file_metadata` - Stores file information, hashes, and session associations

**New Capabilities:**
- Calculate SHA-256 hashes for files and folders
- Track file metadata in database
- Link files to sessions via session_id
- Detect duplicate files via hash matching
- Display tracking status in UI

## Next Steps

Once Phase 2 is verified working:
- **Phase 3:** Shadow Git Repository Creation
  - Copy tracked folders to shadow repos
  - Initialize git in shadow repos
  - Create first commit with session metadata
  - Store git commit hash in database

This will enable true version control of project snapshots!

---

**Status**: Phase 2 Complete ✅
**Next**: Phase 3 - Shadow Git Repository Creation

## Database Schema Reference

```sql
-- file_metadata table
CREATE TABLE file_metadata (
  id TEXT PRIMARY KEY,               -- UUID
  session_id TEXT NOT NULL,          -- Links to session
  file_path TEXT NOT NULL,           -- Absolute path to file/folder
  file_name TEXT NOT NULL,           -- File/folder name
  file_hash TEXT,                    -- SHA-256 hash (nullable)
  file_size INTEGER,                 -- Size in bytes
  file_type TEXT,                    -- 'file', 'folder', 'git-repo'
  modified_at TIMESTAMP,             -- Last modified time
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_file_hash ON file_metadata(file_hash);
CREATE INDEX idx_file_path ON file_metadata(file_path);
CREATE INDEX idx_session_id ON file_metadata(session_id);
```
