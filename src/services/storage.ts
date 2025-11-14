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
import { getFileHash, ProgressCallback } from './fileHash';

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
}

export interface FileContent {
  id: string;
  folder_metadata_id: string;
  relative_path: string;
  file_hash: string;
  file_size: number;
  modified_at: string | null;
  created_at: string;
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('  ✓ Table created: file_metadata');

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
   * Phase 2: Track file attached to a session
   * Calculates hash, stores metadata
   */
  public async trackFile(
    sessionId: string,
    filePath: string,
    onProgress?: ProgressCallback
  ): Promise<FileMetadata> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      console.log(`📎 Tracking file: ${filePath}`);

      // Get file name from path
      const fileName = filePath.split('/').pop() || filePath;

      // Get file metadata
      const fileStats = await stat(filePath);
      const fileType: 'file' | 'folder' | 'git-repo' = fileStats.isDirectory ? 'folder' : 'file';

      // Calculate hash and size
      let fileHash: string | null = null;
      let fileSize: number | null = null;
      let individualFiles: any[] = [];

      try {
        const hashResult = await getFileHash(filePath, onProgress);
        fileHash = hashResult.hash;
        fileSize = hashResult.size;
        individualFiles = hashResult.files || [];
        console.log(`  ✓ Hash calculated: ${fileHash.substring(0, 12)}...`);
        if (fileType === 'folder' && individualFiles.length > 0) {
          console.log(`  ✓ Tracked ${individualFiles.length} individual files`);
        }
      } catch (error) {
        console.warn(`  ⚠️  Could not hash file (will track without hash):`, error);
      }

      // Generate ID
      const id = crypto.randomUUID();

      // Get modified time
      const modifiedAt = fileStats.mtime ? new Date(fileStats.mtime).toISOString() : null;

      // Insert into database
      await this.db.execute(
        `INSERT INTO file_metadata
         (id, session_id, file_path, file_name, file_hash, file_size, file_type, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, sessionId, filePath, fileName, fileHash, fileSize, fileType, modifiedAt]
      );

      console.log(`  ✓ File tracked with ID: ${id}`);

      // If this is a folder, store individual file contents
      if (fileType === 'folder' && individualFiles.length > 0) {
        console.log(`  📝 Storing ${individualFiles.length} individual file hashes...`);
        for (const file of individualFiles) {
          const fileContentId = crypto.randomUUID();
          const fileModifiedAt = file.modifiedAt ? file.modifiedAt.toISOString() : null;

          await this.db.execute(
            `INSERT INTO file_contents
             (id, folder_metadata_id, relative_path, file_hash, file_size, modified_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [fileContentId, id, file.relativePath, file.hash, file.size, fileModifiedAt]
          );
        }
        console.log(`  ✅ Stored ${individualFiles.length} file hashes in database`);
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
        created_at: new Date().toISOString()
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
