# Phase 5: Differential Backup System - Implementation Notes

## What We're Building

A **true differential backup system** that stores only changed files instead of duplicating entire project folders.

### User Requirements

1. **Add Folder + Save (No Link)**:
   - Hash all files
   - Create FULL backup with name: `{project_name}_{date}_{time}`
   - Store all files

2. **Add Folder + Link to Previous**:
   - Select previous backup by name
   - Compare file hashes
   - Create DIFFERENTIAL backup
   - Store ONLY changed files (added/modified)
   - Reference parent for unchanged files

3. **View Backup**:
   - Show backup by human-readable name
   - Reconstruct full project by combining:
     - Parent's unchanged files (reference, not copy)
     - Current version's changed files (actual copies)
     - Exclude deleted files

## What We've Done So Far

### 1. Database Schema Updates ✅

**Location**: `/Users/zaragoel/day-tracker/src/services/storage.ts`

**file_metadata table** - Added columns:
```sql
backup_name TEXT                 -- e.g., "ucmas_2025-11-14_18-30"
is_full_backup INTEGER DEFAULT 0 -- 0 = differential, 1 = full
```

**file_contents table** - Added columns:
```sql
change_type TEXT           -- 'added' | 'modified' | 'unchanged' | 'deleted'
backup_file_path TEXT      -- Path to stored file in backup
```

**TypeScript Interfaces Updated**:
- `FileMetadata`: Added `backup_name`, `is_full_backup`
- `FileContent`: Added `change_type`, `backup_file_path`

### 2. Backup Service Created ✅

**Location**: `/Users/zaragoel/day-tracker/src/services/backupService.ts`

**Key Functions**:
- `generateBackupName(projectName)`: Creates `{project_name}_{date}_{time}`
- `createBackupDirectory(backupName)`: Creates backup folder structure
- `copyFileToBackup(sourcePath, fileHash, backupPath)`: Content-addressed storage
- `detectChanges(currentFiles, parentFiles)`: Compares hashes to find changes
- `createManifest(backupPath, manifest)`: Creates manifest.json
- `readManifest(backupPath)`: Reads manifest.json

**Backup Structure**:
```
backups/
  ucmas_2025-11-14_18-30/          ← Full backup
    files/
      {hash1}                       ← Actual file content
      {hash2}
      {hash3}
    manifest.json                   ← Describes project structure

  ucmas_2025-11-14_19-45/          ← Differential backup
    files/
      {hash4}                       ← Only changed files
    manifest.json
      parent: "ucmas_2025-11-14_18-30"
      files: [...]
```

## What Needs to Be Removed

### Git/Rsync Code to Delete

**Location**: `/Users/zaragoel/day-tracker/src/services/storage.ts`

**Lines to remove** (approx 403-493):
- All `gitService` imports and calls
- Shadow repo creation logic
- rsync file copying
- Git initialization and commits

**Specifically remove**:
```typescript
// Phase 3 & 4: Create shadow git repository for folders
// All code between lines ~403-493 that handles:
- shadowRepoPath creation
- gitService.copyToShadowRepo()
- gitService.initGitRepo()
- gitService.createCommit()
```

**Location**: `/Users/zaragoel/day-tracker/src/services/gitService.ts`
- **DELETE entire file** (no longer needed)

**Location**: `/Users/zaragoel/day-tracker/src-tauri/capabilities/default.json`
- Can optionally remove rsync/git permissions (lines 42-57)
- Not critical, but cleanup

**Location**: `/Users/zaragoel/day-tracker/src-tauri/Cargo.toml`
- Can optionally remove `tauri-plugin-shell` dependency (line 26)
- Not critical if other features use it

## What Still Needs to Be Done

### 1. Update trackFile() Method

**Location**: `/Users/zaragoel/day-tracker/src/services/storage.ts` (lines 361-543)

**Current flow** (TO REPLACE):
```typescript
trackFile(sessionId, filePath, onProgress?, parentMetadataId?) {
  1. Hash files
  2. Create shadow repo with rsync
  3. Git init & commit
  4. Store in database
}
```

**New flow** (TO IMPLEMENT):
```typescript
trackFile(sessionId, filePath, onProgress?, parentMetadataId?) {
  1. Hash files (keep existing code)
  2. Store file hashes in file_contents table (keep existing code)

  3. IF NO PARENT (Full Backup):
     - Generate backup name: backupService.generateBackupName(fileName)
     - Create backup directory
     - Copy ALL files to backup (content-addressed)
     - Create manifest with all files marked as 'added'
     - Store backup_name and is_full_backup=1 in file_metadata

  4. IF HAS PARENT (Differential Backup):
     - Get parent's file_contents from database
     - Compare: backupService.detectChanges(currentFiles, parentFiles)
     - Generate backup name
     - Create backup directory
     - Copy ONLY changed files (added/modified)
     - Create manifest:
       * parent_backup: parent's backup_name
       * files: list with change_type and source (current/parent)
     - Store backup_name and is_full_backup=0 in file_metadata
     - Update file_contents with change_type for each file

  5. Return FileMetadata with backup_name instead of shadow_repo_path
}
```

### 2. Update UI

**Location**: `/Users/zaragoel/day-tracker/src/components/SimpleCalendar.tsx`

**Changes needed**:

1. **FileLink interface** (line 38):
   ```typescript
   interface FileLink {
     // ... existing fields
     backupName?: string;     // NEW: Replace shadowRepoPath
     isFullBackup?: boolean;  // NEW: Replace gitCommitHash
   }
   ```

2. **handleAddFolder** (line 631):
   - Capture `backup_name` instead of `shadow_repo_path`
   - Capture `is_full_backup` instead of `git_commit_hash`

3. **"📸 Backup" button** (line 1287):
   - Change from: `onClick={() => handleOpenFile(file.shadowRepoPath!)}`
   - Change to: `onClick={() => handleOpenBackup(file.backupName!)}`

4. **Add new handler**:
   ```typescript
   const handleOpenBackup = async (backupName: string) => {
     const backupPath = `${storagePath}/backups/${backupName}`;
     await openPath(backupPath);
   };
   ```

5. **Link to Previous dialog** (line 1492):
   - Show backup names instead of file names/paths
   - Display: "{backup_name} ({is_full_backup ? 'Full' : 'Differential'})"

### 3. Initialize Backup Service

**Location**: `/Users/zaragoel/day-tracker/src/services/storage.ts`

**Add to initialize() method** (after line 102):
```typescript
import { backupService } from './backupService';

// In initialize() method:
backupService.setStoragePath(this.storagePath);
```

## How the Manifest File Works

### Manifest Structure

**Full Backup** (`ucmas_2025-11-14_18-30/manifest.json`):
```json
{
  "backup_name": "ucmas_2025-11-14_18-30",
  "created_at": "2025-11-14T18:30:00.000Z",
  "project_name": "ucmas",
  "parent_backup": null,
  "is_full_backup": true,
  "file_count": 1114,
  "total_size": 11200000,
  "files": [
    {
      "relative_path": "src/index.ts",
      "file_hash": "abc123...",
      "file_size": 1024,
      "change_type": "added",
      "source": "current"
    },
    // ... all 1114 files
  ]
}
```

**Differential Backup** (`ucmas_2025-11-14_19-45/manifest.json`):
```json
{
  "backup_name": "ucmas_2025-11-14_19-45",
  "created_at": "2025-11-14T19:45:00.000Z",
  "project_name": "ucmas",
  "parent_backup": "ucmas_2025-11-14_18-30",
  "is_full_backup": false,
  "file_count": 1115,
  "total_size": 11205000,
  "files": [
    {
      "relative_path": "src/index.ts",
      "file_hash": "def456...",
      "file_size": 1536,
      "change_type": "modified",
      "source": "current"      // Get from current backup
    },
    {
      "relative_path": "src/utils.ts",
      "file_hash": "abc123...",
      "file_size": 2048,
      "change_type": "unchanged",
      "source": "parent"       // Get from parent backup
    },
    {
      "relative_path": "src/new.ts",
      "file_hash": "ghi789...",
      "file_size": 512,
      "change_type": "added",
      "source": "current"
    },
    {
      "relative_path": "src/old.ts",
      "file_hash": "jkl012...",
      "file_size": 256,
      "change_type": "deleted",
      "source": "parent"       // Don't include in reconstruction
    }
    // ... all other files
  ]
}
```

### How Backup Reconstruction Works

**To view backup** `ucmas_2025-11-14_19-45`:

1. Read `ucmas_2025-11-14_19-45/manifest.json`
2. For each file in manifest.files:
   ```
   IF change_type === 'deleted':
     SKIP (don't show in reconstruction)

   ELSE IF source === 'current':
     FILE_PATH = backups/ucmas_2025-11-14_19-45/files/{file_hash}

   ELSE IF source === 'parent':
     FILE_PATH = backups/ucmas_2025-11-14_18-30/files/{file_hash}

   SHOW FILE at relative_path pointing to FILE_PATH
   ```

3. Result: Full project structure showing all files except deleted ones

**Storage Savings Example**:
- Full backup: 1114 files × 10KB avg = 11MB stored
- Differential: Only 5 changed files = 50KB stored
- View differential: Shows full 1114 files (references parent)

### File Location Resolution Algorithm

```typescript
function getFileLocation(file, backupPath, parentBackupPath) {
  if (file.change_type === 'deleted') {
    return null; // Don't include
  }

  if (file.source === 'current') {
    return `${backupPath}/files/${file.file_hash}`;
  }

  if (file.source === 'parent') {
    if (!parentBackupPath) {
      throw new Error('Parent backup not found');
    }
    return `${parentBackupPath}/files/${file.file_hash}`;
  }
}
```

## How to Test

### Test 1: Full Backup

1. Clear database and backups:
   ```bash
   rm -rf ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/*
   ```

2. Refresh app (Cmd+R)

3. Add folder → Save (don't link)

4. Verify:
   ```bash
   ls ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/
   # Should see: ucmas_2025-11-14_HH-MM-SS/

   ls ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/ucmas_*/files/
   # Should see: {hash1} {hash2} {hash3} ... (all files)

   cat ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/ucmas_*/manifest.json
   # Should show: is_full_backup: true, parent_backup: null
   ```

5. Database check:
   ```sql
   SELECT backup_name, is_full_backup, parent_metadata_id FROM file_metadata;
   -- Should show: ucmas_2025-11-14_HH-MM-SS, 1, NULL

   SELECT COUNT(*), change_type FROM file_contents GROUP BY change_type;
   -- Should show: 1114 files with change_type 'added'
   ```

### Test 2: Differential Backup

1. Make a small change to one file in ucmas folder

2. Add folder → Link to Previous → Select first backup → Choose folder

3. Verify:
   ```bash
   ls ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/
   # Should see TWO folders:
   # ucmas_2025-11-14_18-30/  (full)
   # ucmas_2025-11-14_19-45/  (differential)

   ls ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/ucmas_*_19-45/files/
   # Should see: Only 1 file (the changed one)

   cat ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/ucmas_*_19-45/manifest.json
   # Should show:
   #   is_full_backup: false
   #   parent_backup: "ucmas_2025-11-14_18-30"
   #   files with change_type: 1 modified, 1113 unchanged, 0 added, 0 deleted
   ```

4. Database check:
   ```sql
   SELECT backup_name, is_full_backup, parent_metadata_id FROM file_metadata ORDER BY created_at;
   -- Should show two entries, second one has parent_metadata_id pointing to first

   SELECT change_type, COUNT(*) FROM file_contents WHERE folder_metadata_id = '{second_id}' GROUP BY change_type;
   -- Should show: 1 modified, 1113 unchanged
   ```

5. Size check:
   ```bash
   du -sh ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/ucmas_*_18-30
   # ~11 MB

   du -sh ~/Library/Application\ Support/com.zaragoel.day-tracker-temp/backups/ucmas_*_19-45
   # ~10 KB (only changed file!)
   ```

### Test 3: Backup Viewing

1. Click "📸 Backup" button on first folder
   - Should open: `ucmas_2025-11-14_18-30/`
   - Should see: manifest.json and files/ directory

2. Click "📸 Backup" button on second folder
   - Should open: `ucmas_2025-11-14_19-45/`
   - Should see: manifest.json and files/ directory with fewer files

3. Manual reconstruction test:
   - Read manifest from differential backup
   - For each file, verify you can locate it in current or parent backup
   - All files except deleted ones should be accessible

## Current Status

✅ **Completed**:
- Database schema updated
- Backup service created
- Manifest structure designed

⏳ **In Progress**:
- Updating trackFile() method

❌ **Not Started**:
- Removing git/rsync code
- UI updates
- Testing

## Next Steps

1. Update `trackFile()` in storage.ts to implement new backup logic
2. Remove all git/rsync code
3. Update UI to show backup names
4. Initialize backup service with storage path
5. Test full backup creation
6. Test differential backup creation
7. Verify storage savings

## File Locations Reference

| Component | Location |
|-----------|----------|
| Database Schema | `/Users/zaragoel/day-tracker/src/services/storage.ts` (lines 182-286) |
| Backup Service | `/Users/zaragoel/day-tracker/src/services/backupService.ts` |
| trackFile Method | `/Users/zaragoel/day-tracker/src/services/storage.ts` (lines 361-543) |
| Git Service (DELETE) | `/Users/zaragoel/day-tracker/src/services/gitService.ts` |
| UI Component | `/Users/zaragoel/day-tracker/src/components/SimpleCalendar.tsx` |
| Shell Permissions | `/Users/zaragoel/day-tracker/src-tauri/capabilities/default.json` (lines 42-57) |
