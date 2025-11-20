/**
 * Phase 1: Storage Folder Infrastructure
 *
 * This module handles:
 * - Creating storage directory structure
 * - Initializing SQLite database
 * - Managing storage configuration
 */

import Database from '@tauri-apps/plugin-sql';
import { mkdir, exists, BaseDirectory, stat } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { getFileHash as _getFileHash, ProgressCallback } from './fileHash';
import { backupService, BackupManifest as _BackupManifest } from './backupService';

export interface StorageConfig {
  id: number;
  storage_path: string;
  total_size_bytes: number;
  created_at: string;
}

export interface FileMetadata {
  id: string;
  session_id: string;
  file_path: string;
  file_name: string;
  file_hash: string | null;
  file_size: number | null;
  file_type: 'file' | 'folder' | 'git-repo';
  modified_at: string | null;
  created_at: string;
  // Phase 3: Shadow git repository fields (deprecated in Phase 5)
  shadow_repo_path: string | null;
  git_commit_hash: string | null;
  // Phase 4: Project linking
  parent_metadata_id: string | null;
  // Phase 5: Differential backups
  backup_name: string | null;
  is_full_backup: number; // 0 or 1 (SQLite boolean)
}

export interface FileContent {
  id: string;
  folder_metadata_id: string;
  relative_path: string;
  file_hash: string;
  file_size: number;
  modified_at: string | null;
  created_at: string;
  // Phase 5: Change tracking
  change_type: 'added' | 'modified' | 'unchanged' | 'deleted' | null;
  backup_file_path: string | null;
}

export class StorageService {
  private static instance: StorageService;
  private db: Database | null = null;
  private storagePath: string = '';
  private initialized: boolean = false;
  private initializing: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /**
   * Initialize storage infrastructure
   * Creates directory structure and database
   */
  public async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.initialized) {
      console.log('✅ Storage already initialized');
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializing) {
      console.log('⏳ Storage initialization in progress, waiting...');
      return this.initializing;
    }

    // Start initialization
    this.initializing = this.doInitialize();

    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  /**
   * Internal initialization logic
   */
  private async doInitialize(): Promise<void> {
    try {
      console.log('🚀 Initializing storage infrastructure...');

      // Step 1: Get app data directory path
      const appData = await appDataDir();
      this.storagePath = appData;
      console.log(`📁 App data directory: ${this.storagePath}`);

      // Step 2: Create directory structure
      await this.createDirectoryStructure();

      // Step 3: Initialize database
      await this.initializeDatabase();

      // Step 4: Verify storage config
      await this.ensureStorageConfig();

      // Phase 5: Initialize backup service with storage path
      backupService.setStoragePath(this.storagePath);
      console.log('  ✓ Backup service initialized');

      this.initialized = true;
      console.log('✅ Storage infrastructure initialized successfully!');
    } catch (error) {
      console.error('❌ Failed to initialize storage:', error);
      throw error;
    }
  }

  /**
   * Create required directory structure:
   * - storage/
   *   - files/
   *   - diffs/
   * - git-repos/
   */
  private async createDirectoryStructure(): Promise<void> {
    console.log('📂 Creating directory structure...');

    const directories = [
      'storage',
      'storage/files',
      'storage/diffs',
      'git-repos'
    ];

    for (const dir of directories) {
      try {
        const dirExists = await exists(dir, { baseDir: BaseDirectory.AppData });

        if (!dirExists) {
          await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
          console.log(`  ✓ Created: ${dir}`);
        } else {
          console.log(`  ✓ Exists: ${dir}`);
        }
      } catch (error) {
        console.error(`  ✗ Failed to create ${dir}:`, error);
        throw error;
      }
    }

    console.log('✅ Directory structure created');
  }

  /**
   * Initialize SQLite database
   * Creates database file and tables
   */
  private async initializeDatabase(): Promise<void> {
    console.log('🗄️  Initializing database...');

    try {
      // Load database (creates if doesn't exist)
      this.db = await Database.load('sqlite:metadata.db');
      console.log('  ✓ Database loaded');

      // Create storage_config table
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS storage_config (
          id INTEGER PRIMARY KEY,
          storage_path TEXT NOT NULL,
          total_size_bytes INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('  ✓ Table created: storage_config');

      // Phase 2: Create file_metadata table
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS file_metadata (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_hash TEXT,
          file_size INTEGER,
          file_type TEXT,
          modified_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          shadow_repo_path TEXT,
          git_commit_hash TEXT,
          parent_metadata_id TEXT
        )
      `);
      console.log('  ✓ Table created: file_metadata');

      // Phase 4: Add parent_metadata_id column if it doesn't exist
      try {
        await this.db.execute(`
          ALTER TABLE file_metadata ADD COLUMN parent_metadata_id TEXT
        `);
        console.log('  ✓ Column added: parent_metadata_id');
      } catch (error) {
        // Column might already exist, that's okay
        console.log('  ℹ️  Column parent_metadata_id already exists or error:', error);
      }

      // Phase 5: Add differential backup columns
      try {
        await this.db.execute(`
          ALTER TABLE file_metadata ADD COLUMN backup_name TEXT
        `);
        console.log('  ✓ Column added: backup_name');
      } catch (error) {
        console.log('  ℹ️  Column backup_name already exists or error:', error);
      }

      try {
        await this.db.execute(`
          ALTER TABLE file_metadata ADD COLUMN is_full_backup INTEGER DEFAULT 0
        `);
        console.log('  ✓ Column added: is_full_backup');
      } catch (error) {
        console.log('  ℹ️  Column is_full_backup already exists or error:', error);
      }

      // Create indexes for file_metadata
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_file_hash ON file_metadata(file_hash)
      `);
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_file_path ON file_metadata(file_path)
      `);
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_session_id ON file_metadata(session_id)
      `);
      console.log('  ✓ Indexes created');

      // Phase 2.5: Create file_contents table for granular file tracking
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS file_contents (
          id TEXT PRIMARY KEY,
          folder_metadata_id TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          file_hash TEXT NOT NULL,
          file_size INTEGER,
          modified_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (folder_metadata_id) REFERENCES file_metadata(id)
        )
      `);
      console.log('  ✓ Table created: file_contents');

      // Create indexes for file_contents
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_file_contents_hash ON file_contents(file_hash)
      `);
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_file_contents_folder ON file_contents(folder_metadata_id)
      `);
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_file_contents_path ON file_contents(relative_path)
      `);
      console.log('  ✓ Indexes created for file_contents');

      // Phase 5: Add change tracking columns to file_contents
      try {
        await this.db.execute(`
          ALTER TABLE file_contents ADD COLUMN change_type TEXT
        `);
        console.log('  ✓ Column added: change_type');
      } catch (error) {
        console.log('  ℹ️  Column change_type already exists or error:', error);
      }

      try {
        await this.db.execute(`
          ALTER TABLE file_contents ADD COLUMN backup_file_path TEXT
        `);
        console.log('  ✓ Column added: backup_file_path');
      } catch (error) {
        console.log('  ℹ️  Column backup_file_path already exists or error:', error);
      }

      // Phase 6: Create sessions table for dual storage
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          labels TEXT,
          notes TEXT,
          column_index INTEGER DEFAULT 0,
          created_at TEXT,
          updated_at TEXT
        )
      `);
      console.log('  ✓ Table created: sessions');

      // Migration: Add column_index to existing sessions table if it doesn't exist
      try {
        await this.db.execute(`
          ALTER TABLE sessions ADD COLUMN column_index INTEGER DEFAULT 0
        `);
        console.log('  ✓ Added column_index to sessions table');
      } catch (error) {
        // Column already exists, ignore error
        console.log('  ✓ column_index already exists in sessions table');
      }

      // Create index for sessions by time
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(start_time, end_time)
      `);
      console.log('  ✓ Indexes created for sessions');

      console.log('✅ Database initialized');
    } catch (error) {
      console.error('  ✗ Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * Ensure storage configuration exists
   * Creates default config if none exists
   */
  private async ensureStorageConfig(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    console.log('⚙️  Checking storage configuration...');

    try {
      // Check if config exists
      const result = await this.db.select<StorageConfig[]>(
        'SELECT * FROM storage_config WHERE id = 1'
      );

      if (result.length === 0) {
        // Create default config - use INSERT OR IGNORE to handle race conditions
        try {
          await this.db.execute(
            'INSERT OR IGNORE INTO storage_config (id, storage_path, total_size_bytes) VALUES (1, ?, 0)',
            [this.storagePath]
          );
          console.log('  ✓ Created default storage config');
        } catch (insertError) {
          // If insert fails, config might have been created by another instance
          console.log('  ✓ Storage config already exists (created by concurrent initialization)');
        }
      } else {
        console.log('  ✓ Storage config exists');
        console.log(`     Path: ${result[0].storage_path}`);
        console.log(`     Size: ${result[0].total_size_bytes} bytes`);
      }

      console.log('✅ Storage configuration verified');
    } catch (error) {
      console.error('  ✗ Failed to ensure storage config:', error);
      throw error;
    }
  }

  /**
   * Get current storage configuration
   */
  public async getStorageConfig(): Promise<StorageConfig | null> {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    try {
      const result = await this.db.select<StorageConfig[]>(
        'SELECT * FROM storage_config WHERE id = 1'
      );
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Failed to get storage config:', error);
      return null;
    }
  }

  /**
   * Update total storage size
   */
  public async updateStorageSize(sizeBytes: number): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      await this.db.execute(
        'UPDATE storage_config SET total_size_bytes = ? WHERE id = 1',
        [sizeBytes]
      );
      console.log(`Updated storage size: ${sizeBytes} bytes`);
    } catch (error) {
      console.error('Failed to update storage size:', error);
      throw error;
    }
  }

  /**
   * Get database instance
   */
  public getDatabase(): Database | null {
    return this.db;
  }

  /**
   * Get storage path
   */
  public getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Check if storage is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Phase 5: Track file and optionally create backup
   * If skipBackup is true, only hashes files and stores metadata
   */
  public async trackFile(
    sessionId: string,
    filePath: string,
    _onProgress?: ProgressCallback,
    parentMetadataId?: string,
    skipBackup?: boolean
  ): Promise<FileMetadata> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      console.log(`📎 Tracking file: ${filePath}`);

      // Get file name from path
      const fileName = filePath.split('/').pop() || filePath;

      // Get file metadata
      const fileStats = await stat(filePath);
      const fileType: 'file' | 'folder' | 'git-repo' = fileStats.isDirectory ? 'folder' : 'file';

      // Skip hashing - just copy files/folders directly
      let fileHash: string | null = null;
      let fileSize: number | null = fileStats.size || 0;
      let individualFiles: any[] = [];

      console.log(`  📦 Skipping hash - will copy directly`);

      // Generate ID
      const id = crypto.randomUUID();

      // Get modified time
      const modifiedAt = fileStats.mtime ? new Date(fileStats.mtime).toISOString() : null;

      // Simple backup: Copy folders or files
      let backupName: string | null = null;
      let isFullBackup = 0;
      let fileContentsToInsert: any[] = [];

      if (!skipBackup) {
        try {
          // Generate backup name: {project_name}_{date}_{time}
          backupName = backupService.generateBackupName(fileName);
          const backupPath = `${this.storagePath}/backups/${backupName}`;

          console.log(`\n💾 Creating backup: ${backupName}`);
          console.log(`  Source: ${filePath}`);
          console.log(`  Destination: ${backupPath}`);

          if (fileType === 'folder') {
            // Use rsync to copy entire folder (preserves structure and permissions)
            const { Command } = await import('@tauri-apps/plugin-shell');
            const rsync = await Command.create('rsync', [
              '-a',              // archive mode (recursive, preserves everything)
              '--exclude', '.git',  // exclude .git folders
              filePath + '/',    // source (trailing slash = contents)
              backupPath + '/'   // destination
            ]);

            console.log(`  📦 Copying folder with rsync...`);
            const output = await rsync.execute();

            if (output.code === 0) {
              console.log(`  ✅ Backup created successfully`);
              isFullBackup = 1;

              // Store file contents for database (if we hashed individual files)
              if (individualFiles.length > 0) {
                fileContentsToInsert = individualFiles.map(file => ({
                  id: crypto.randomUUID(),
                  folder_metadata_id: id,
                  relative_path: file.relativePath,
                  file_hash: file.hash,
                  file_size: file.size,
                  modified_at: file.modifiedAt ? file.modifiedAt.toISOString() : null,
                  change_type: 'added',
                  backup_file_path: `${backupPath}/${file.relativePath}`
                }));
              }
            } else {
              console.error(`  ❌ rsync failed with code ${output.code}`);
              console.error(output.stderr);
              backupName = null;
            }
          } else {
            // For individual files, use cp command to copy
            const { Command } = await import('@tauri-apps/plugin-shell');

            // Create backup directory for the file
            const mkdirCmd = await Command.create('mkdir', ['-p', backupPath]);
            await mkdirCmd.execute();

            // Copy the file to backup location
            const cp = await Command.create('cp', [
              '-p',              // preserve file attributes
              filePath,          // source file
              backupPath + '/'   // destination directory
            ]);

            console.log(`  📄 Copying file with cp...`);
            const output = await cp.execute();

            if (output.code === 0) {
              console.log(`  ✅ File backup created successfully`);
              isFullBackup = 1;

              // Store file content record for individual file
              const backupFilePath = `${backupPath}/${fileName}`;
              fileContentsToInsert = [{
                id: crypto.randomUUID(),
                folder_metadata_id: id,
                relative_path: fileName,
                file_hash: fileHash,
                file_size: fileSize,
                modified_at: modifiedAt,
                change_type: 'added',
                backup_file_path: backupFilePath
              }];
            } else {
              console.error(`  ❌ cp failed with code ${output.code}`);
              console.error(output.stderr);
              backupName = null;
            }
          }

        } catch (error) {
          console.error(`  ⚠️  Failed to create backup:`, error);
          backupName = null;
          isFullBackup = 0;
          fileContentsToInsert = [];
        }
      }

      // Insert file_metadata FIRST (required for foreign key constraint)
      await this.db.execute(
        `INSERT INTO file_metadata
         (id, session_id, file_path, file_name, file_hash, file_size, file_type, modified_at, backup_name, is_full_backup, parent_metadata_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, sessionId, filePath, fileName, fileHash, fileSize, fileType, modifiedAt, backupName, isFullBackup, parentMetadataId || null]
      );

      console.log(`  ✓ File tracked with ID: ${id}`);

      // Now insert file_contents (references file_metadata.id)
      if (fileContentsToInsert.length > 0) {
        console.log(`  📝 Storing ${fileContentsToInsert.length} file records...`);
        for (const fileContent of fileContentsToInsert) {
          await this.db.execute(
            `INSERT INTO file_contents
             (id, folder_metadata_id, relative_path, file_hash, file_size, modified_at, change_type, backup_file_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [fileContent.id, fileContent.folder_metadata_id, fileContent.relative_path, fileContent.file_hash, fileContent.file_size, fileContent.modified_at, fileContent.change_type, fileContent.backup_file_path]
          );
        }
        console.log(`  ✅ Stored ${fileContentsToInsert.length} file records`);
      }

      const metadata: FileMetadata = {
        id,
        session_id: sessionId,
        file_path: filePath,
        file_name: fileName,
        file_hash: fileHash,
        file_size: fileSize,
        file_type: fileType,
        modified_at: modifiedAt,
        created_at: new Date().toISOString(),
        shadow_repo_path: null,
        git_commit_hash: null,
        parent_metadata_id: parentMetadataId || null,
        backup_name: backupName,
        is_full_backup: isFullBackup
      };

      return metadata;
    } catch (error) {
      console.error('Failed to track file:', error);
      throw error;
    }
  }

  /**
   * Get all files tracked for a session
   */
  public async getSessionFiles(sessionId: string): Promise<FileMetadata[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const results = await this.db.select<FileMetadata[]>(
        'SELECT * FROM file_metadata WHERE session_id = ? ORDER BY created_at DESC',
        [sessionId]
      );
      return results;
    } catch (error) {
      console.error('Failed to get session files:', error);
      return [];
    }
  }

  /**
   * Find files by hash
   */
  public async findFilesByHash(hash: string): Promise<FileMetadata[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const results = await this.db.select<FileMetadata[]>(
        'SELECT * FROM file_metadata WHERE file_hash = ? ORDER BY created_at DESC',
        [hash]
      );
      return results;
    } catch (error) {
      console.error('Failed to find files by hash:', error);
      return [];
    }
  }

  /**
   * Phase 4: Get all previously tracked folders with shadow repositories
   * Used for manual project linking
   */
  public async getPreviousTrackedFolders(): Promise<FileMetadata[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const results = await this.db.select<FileMetadata[]>(
        `SELECT * FROM file_metadata
         WHERE file_type = 'folder'
         AND shadow_repo_path IS NOT NULL
         ORDER BY created_at DESC`
      );
      return results;
    } catch (error) {
      console.error('Failed to get previous tracked folders:', error);
      return [];
    }
  }

  /**
   * Find files by path
   */
  public async findFilesByPath(path: string): Promise<FileMetadata[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const results = await this.db.select<FileMetadata[]>(
        'SELECT * FROM file_metadata WHERE file_path = ? ORDER BY created_at DESC',
        [path]
      );
      return results;
    } catch (error) {
      console.error('Failed to find files by path:', error);
      return [];
    }
  }

  /**
   * Get individual file contents for a folder
   */
  public async getFolderContents(folderMetadataId: string): Promise<FileContent[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const results = await this.db.select<FileContent[]>(
        'SELECT * FROM file_contents WHERE folder_metadata_id = ? ORDER BY relative_path ASC',
        [folderMetadataId]
      );
      return results;
    } catch (error) {
      console.error('Failed to get folder contents:', error);
      return [];
    }
  }

  /**
   * Delete file metadata and associated file contents
   */
  public async deleteFileMetadata(metadataId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      console.log(`🗑️  Deleting file metadata: ${metadataId}`);

      // First delete associated file contents (if any)
      await this.db.execute(
        'DELETE FROM file_contents WHERE folder_metadata_id = ?',
        [metadataId]
      );

      // Then delete the file metadata itself
      await this.db.execute(
        'DELETE FROM file_metadata WHERE id = ?',
        [metadataId]
      );

      console.log(`  ✓ File metadata deleted`);
    } catch (error) {
      console.error('Failed to delete file metadata:', error);
      throw error;
    }
  }

  /**
   * Delete all files associated with a session
   */
  public async deleteSessionFiles(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      console.log(`🗑️  Deleting all files for session: ${sessionId}`);

      // Get all file metadata IDs for this session
      const files = await this.getSessionFiles(sessionId);

      // Delete file contents for each folder
      for (const file of files) {
        if (file.file_type === 'folder') {
          await this.db.execute(
            'DELETE FROM file_contents WHERE folder_metadata_id = ?',
            [file.id]
          );
        }
      }

      // Delete all file metadata for this session
      await this.db.execute(
        'DELETE FROM file_metadata WHERE session_id = ?',
        [sessionId]
      );

      console.log(`  ✓ Deleted ${files.length} file(s) for session`);
    } catch (error) {
      console.error('Failed to delete session files:', error);
      throw error;
    }
  }

  /**
   * Find folders that contain a specific file hash
   */
  public async findFoldersWithFileHash(fileHash: string): Promise<{
    folderMetadata: FileMetadata;
    matchingFiles: FileContent[];
  }[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      // Find all file_contents with this hash
      const matchingContents = await this.db.select<FileContent[]>(
        'SELECT * FROM file_contents WHERE file_hash = ?',
        [fileHash]
      );

      // Group by folder and get folder metadata
      const folderMap = new Map<string, FileContent[]>();
      for (const content of matchingContents) {
        if (!folderMap.has(content.folder_metadata_id)) {
          folderMap.set(content.folder_metadata_id, []);
        }
        folderMap.get(content.folder_metadata_id)!.push(content);
      }

      // Get folder metadata for each
      const results = [];
      for (const [folderId, files] of folderMap) {
        const folderMetadata = await this.db.select<FileMetadata[]>(
          'SELECT * FROM file_metadata WHERE id = ?',
          [folderId]
        );
        if (folderMetadata.length > 0) {
          results.push({
            folderMetadata: folderMetadata[0],
            matchingFiles: files
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to find folders with file hash:', error);
      return [];
    }
  }

  /**
   * Calculate similarity between two folders based on file hashes
   * Returns percentage of matching files
   */
  public async calculateFolderSimilarity(
    folderMetadataId1: string,
    folderMetadataId2: string
  ): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const contents1 = await this.getFolderContents(folderMetadataId1);
      const contents2 = await this.getFolderContents(folderMetadataId2);

      if (contents1.length === 0 || contents2.length === 0) return 0;

      const hashes1 = new Set(contents1.map(f => f.file_hash));
      const hashes2 = new Set(contents2.map(f => f.file_hash));

      let matchCount = 0;
      for (const hash of hashes1) {
        if (hashes2.has(hash)) matchCount++;
      }

      // Percentage based on the larger set
      const maxSize = Math.max(hashes1.size, hashes2.size);
      return (matchCount / maxSize) * 100;
    } catch (error) {
      console.error('Failed to calculate folder similarity:', error);
      return 0;
    }
  }

  /**
   * Save a single session to database
   */
  public async saveSession(session: {
    id: string;
    title: string;
    date: string;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    labels: string[];
    notes?: string;
    column?: number;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      // Create ISO timestamps for start and end times
      // Parse date as YYYY-MM-DD and create date in local time (not UTC)
      const [year, month, day] = session.date.split('-').map(Number);
      const startTime = new Date(year, month - 1, day, session.startHour, session.startMinute, 0, 0);
      const endTime = new Date(year, month - 1, day, session.endHour, session.endMinute, 0, 0);

      const now = new Date().toISOString();

      await this.db.execute(
        `INSERT OR REPLACE INTO sessions
         (id, title, start_time, end_time, labels, notes, column_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.id,
          session.title,
          startTime.toISOString(),
          endTime.toISOString(),
          JSON.stringify(session.labels),
          session.notes || null,
          session.column || 0,
          session.createdAt?.toISOString() || now,
          now
        ]
      );
    } catch (error) {
      console.error('Failed to save session:', error);
      throw error;
    }
  }

  /**
   * Save multiple sessions to database (bulk operation)
   */
  public async saveSessions(sessions: {
    id: string;
    title: string;
    date: string;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    labels: string[];
    notes?: string;
    column?: number;
  }[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      for (const session of sessions) {
        await this.saveSession(session);
      }
      console.log(`✅ Saved ${sessions.length} sessions to database`);
    } catch (error) {
      console.error('Failed to save sessions:', error);
      throw error;
    }
  }

  /**
   * Load all sessions from database
   */
  public async loadSessions(): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const sessions = await this.db.select<any[]>(
        'SELECT * FROM sessions ORDER BY start_time ASC'
      );

      // Parse JSON labels
      return sessions.map(session => ({
        ...session,
        labels: session.labels ? JSON.parse(session.labels) : []
      }));
    } catch (error) {
      console.error('Failed to load sessions:', error);
      return [];
    }
  }

  /**
   * Get a single session by ID
   */
  public async getSession(sessionId: string): Promise<any | null> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const sessions = await this.db.select<any[]>(
        'SELECT * FROM sessions WHERE id = ?',
        [sessionId]
      );

      if (sessions.length === 0) return null;

      const session = sessions[0];
      return {
        ...session,
        labels: session.labels ? JSON.parse(session.labels) : []
      };
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * Delete a session from database
   */
  public async deleteSession(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      await this.db.execute(
        'DELETE FROM sessions WHERE id = ?',
        [sessionId]
      );
      console.log(`✅ Deleted session ${sessionId} from database`);
    } catch (error) {
      console.error('Failed to delete session:', error);
      throw error;
    }
  }

  /**
   * Delete all sessions from database
   */
  public async deleteAllSessions(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      await this.db.execute('DELETE FROM sessions');
      console.log('✅ Deleted all sessions from database');
    } catch (error) {
      console.error('Failed to delete all sessions:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.initialized = false;
      console.log('✅ Storage closed');
    }
  }
}

// Export singleton instance
export const storageService = StorageService.getInstance();
