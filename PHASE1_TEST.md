# Phase 1 Testing Guide: Storage Infrastructure

## What Was Implemented

✅ Storage directory structure
✅ SQLite database initialization
✅ Storage configuration table
✅ App startup integration

## How to Test

### 1. Check Browser Console
The app should be running now. In the Tauri app window:
1. Right-click anywhere → **Inspect Element** (or press `Cmd+Option+I`)
2. Click on the **Console** tab3. Look for these log messages:

```
🚀 Initializing storage infrastructure...
📁 App data directory: /Users/zaragoel/Library/Application Support/day-tracker-temp
📂 Creating directory structure...
  ✓ Created: storage
  ✓ Created: storage/files
  ✓ Created: storage/diffs
  ✓ Created: git-repos
✅ Directory structure created
🗄️  Initializing database...
  ✓ Database loaded
  ✓ Table created: storage_config
✅ Database initialized
⚙️  Checking storage configuration...
  ✓ Created default storage config
✅ Storage configuration verified
✅ Storage infrastructure initialized successfully!
📊 Storage Info:
   Path: /Users/zaragoel/Library/Application Support/day-tracker-temp
   Size: 0.00 MB
   Created: [timestamp]
```

### 2. Verify Directory Structure

Run this command in terminal:

```bash
ls -la ~/Library/Application\ Support/day-tracker-temp/
```

**Expected output:**
```
drwxr-xr-x  day-tracker-temp/
drwxr-xr-x  git-repos/
drwxr-xr-x  metadata.db
drwxr-xr-x  storage/
```

Then check subdirectories:

```bash
ls -la ~/Library/Application\ Support/day-tracker-temp/storage/
```

**Expected output:**
```
drwxr-xr-x  diffs/
drwxr-xr-x  files/
```

### 3. Verify Database

Check database file exists:

```bash
file ~/Library/Application\ Support/day-tracker-temp/metadata.db
```

**Expected output:**
```
metadata.db: SQLite 3.x database
```

### 4. Test Error Handling

If you see an error screen saying "⚠️ Storage Initialization Error", check:
1. File system permissions
2. Console for detailed error message
3. Tauri capabilities are configured correctly

### 5. Visual Confirmation

When you first load the app, you should briefly see:
```
🚀 Initializing Storage...
Setting up local storage infrastructure
```

Then it should load the normal calendar view.

## Success Criteria

✅ No error screens on startup
✅ Console shows all initialization steps
✅ Directories exist at the correct path
✅ `metadata.db` file created
✅ `storage_config` table has 1 row
✅ App loads normally after initialization

## Troubleshooting

**Problem: Directory not created**
- Check console for errors
- Verify Tauri permissions in `src-tauri/capabilities/default.json`
- Check `fs:allow-mkdir` permission is present

**Problem: Database error**
- Check if `metadata.db` file exists
- Verify SQL permissions in capabilities
- Look for SQL-related errors in console

**Problem: App shows loading screen forever**
- Open DevTools console to see the error
- Check if there's a JavaScript error preventing initialization
- Verify all imports are correct

## Next Steps

Once Phase 1 is verified working:
- Move to Phase 2: File Metadata Tracking
- This will add actual file attachment tracking
- Database will start storing file information

## Test Commands Summary

```bash
# Check if directories exist
ls -la ~/Library/Application\ Support/day-tracker-temp/

# Check subdirectories
tree ~/Library/Application\ Support/day-tracker-temp/

# Verify database
file ~/Library/Application\ Support/day-tracker-temp/metadata.db

# Query database (requires sqlite3)
sqlite3 ~/Library/Application\ Support/day-tracker-temp/metadata.db "SELECT * FROM storage_config;"
```

## Expected Database Content

```sql
sqlite> SELECT * FROM storage_config;
id|storage_path|total_size_bytes|created_at
1|/Users/zaragoel/Library/Application Support/day-tracker-temp|0|2025-11-14 21:05:50
```

---

**Status**: Phase 1 Complete ✅
**Next**: Phase 2 - File Metadata Tracking
