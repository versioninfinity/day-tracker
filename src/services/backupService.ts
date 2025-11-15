/**
 * Phase 5: Differential Backup Service
 *
 * Handles:
 * - Creating backups with human-readable names
 * - Storing only changed files
 * - Reconstructing full project from parent + changes
 */

import { copyFile, mkdir, exists, readFile, writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { FileContent } from './storage';

export interface BackupManifest {
  backup_name: string;
  created_at: string;
  project_name: string;
  parent_backup: string | null;
  is_full_backup: boolean;
  file_count: number;
  total_size: number;
  files: {
    relative_path: string;
    file_hash: string;
    file_size: number;
    change_type: 'added' | 'modified' | 'unchanged' | 'deleted';
    source: 'current' | 'parent'; // Where to get the file from
  }[];
}

export interface FileChange {
  relative_path: string;
  file_hash: string;
  file_size: number;
  change_type: 'added' | 'modified' | 'unchanged' | 'deleted';
  source_path?: string; // Full path to source file (for copying)
}

export class BackupService {
  private static instance: BackupService;
  private storagePath: string = '';

  private constructor() {}

  public static getInstance(): BackupService {
    if (!BackupService.instance) {
      BackupService.instance = new BackupService();
    }
    return BackupService.instance;
  }

  public setStoragePath(path: string) {
    this.storagePath = path;
  }

  /**
   * Generate backup name: {project_name}_{date}_{time}
   */
  public generateBackupName(projectName: string): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    return `${projectName}_${date}_${time}`;
  }

  /**
   * Create backup directory structure
   */
  public async createBackupDirectory(backupName: string): Promise<string> {
    const backupPath = `${this.storagePath}/backups/${backupName}`;
    const filesPath = `${backupPath}/files`;

    // Create directories
    await mkdir(backupPath, { recursive: true });
    await mkdir(filesPath, { recursive: true });

    console.log(`  ✓ Created backup directory: ${backupName}`);
    return backupPath;
  }

  /**
   * Copy file to content-addressed storage
   * Returns the path where the file was stored
   */
  public async copyFileToBackup(
    sourcePath: string,
    fileHash: string,
    backupPath: string
  ): Promise<string> {
    const destPath = `${backupPath}/files/${fileHash}`;

    try {
      // Check if source exists
      const sourceExists = await exists(sourcePath);
      if (!sourceExists) {
        console.warn(`Source file does not exist: ${sourcePath}`);
        return destPath;
      }

      // Check if file already exists (deduplication)
      const fileExists = await exists(destPath);
      if (!fileExists) {
        const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);
        console.log(`Copying: ${fileName} -> ${fileHash.substring(0, 8)}...`);

        // Manual copy using read/write (copyFile might have permission issues)
        try {
          const content = await readFile(sourcePath);
          await writeFile(destPath, content);

          // Verify the copy worked
          const copied = await exists(destPath);
          if (copied) {
            console.log(`  ✓ Copied successfully`);
          } else {
            console.error(`  ✗ Copy failed - destination file does not exist`);
          }
        } catch (copyError) {
          console.error(`  ✗ Copy error:`, copyError);
          throw copyError;
        }
      }
    } catch (error) {
      console.error(`Failed to copy file: ${sourcePath} -> ${destPath}`, error);
      throw error;
    }

    return destPath;
  }

  /**
   * Compare current files with parent to detect changes
   */
  public detectChanges(
    currentFiles: FileContent[],
    parentFiles: FileContent[]
  ): FileChange[] {
    const changes: FileChange[] = [];
    const parentMap = new Map(parentFiles.map(f => [f.relative_path, f]));
    const currentMap = new Map(currentFiles.map(f => [f.relative_path, f]));

    // Check for added and modified files
    for (const current of currentFiles) {
      const parent = parentMap.get(current.relative_path);

      if (!parent) {
        // New file
        changes.push({
          relative_path: current.relative_path,
          file_hash: current.file_hash,
          file_size: current.file_size,
          change_type: 'added',
        });
      } else if (parent.file_hash !== current.file_hash) {
        // Modified file
        changes.push({
          relative_path: current.relative_path,
          file_hash: current.file_hash,
          file_size: current.file_size,
          change_type: 'modified',
        });
      } else {
        // Unchanged file
        changes.push({
          relative_path: current.relative_path,
          file_hash: current.file_hash,
          file_size: current.file_size,
          change_type: 'unchanged',
        });
      }
    }

    // Check for deleted files
    for (const parent of parentFiles) {
      if (!currentMap.has(parent.relative_path)) {
        changes.push({
          relative_path: parent.relative_path,
          file_hash: parent.file_hash,
          file_size: parent.file_size,
          change_type: 'deleted',
        });
      }
    }

    return changes;
  }

  /**
   * Create backup manifest file
   */
  public async createManifest(
    backupPath: string,
    manifest: BackupManifest
  ): Promise<void> {
    const manifestPath = `${backupPath}/manifest.json`;
    await writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  ✓ Created manifest: ${manifest.file_count} files`);
  }

  /**
   * Read backup manifest
   */
  public async readManifest(backupPath: string): Promise<BackupManifest | null> {
    try {
      const manifestPath = `${backupPath}/manifest.json`;
      const content = await readFile(manifestPath);
      const text = new TextDecoder().decode(content);
      return JSON.parse(text);
    } catch (error) {
      console.error('Failed to read manifest:', error);
      return null;
    }
  }

  /**
   * Get backup statistics
   */
  public getBackupStats(changes: FileChange[]): {
    added: number;
    modified: number;
    unchanged: number;
    deleted: number;
    totalSize: number;
  } {
    return {
      added: changes.filter(c => c.change_type === 'added').length,
      modified: changes.filter(c => c.change_type === 'modified').length,
      unchanged: changes.filter(c => c.change_type === 'unchanged').length,
      deleted: changes.filter(c => c.change_type === 'deleted').length,
      totalSize: changes.reduce((sum, c) => sum + (c.file_size || 0), 0),
    };
  }

  /**
   * Reconstruct backup with original folder structure
   * Creates symlinks to actual files from content-addressed storage
   */
  public async reconstructBackup(backupName: string): Promise<string> {
    const backupPath = `${this.storagePath}/backups/${backupName}`;
    const reconstructedPath = `${backupPath}/RECONSTRUCTED`;

    console.log(`🔄 Reconstructing backup: ${backupName}`);

    // Read manifest
    const manifest = await this.readManifest(backupPath);
    if (!manifest) {
      throw new Error('Manifest not found');
    }

    // Check if already reconstructed
    const reconstructedExists = await exists(reconstructedPath);
    if (reconstructedExists) {
      console.log(`  ✓ Already reconstructed at: ${reconstructedPath}`);
      return reconstructedPath;
    }

    // Create reconstructed directory
    await mkdir(reconstructedPath, { recursive: true });

    let filesReconstructed = 0;
    let filesSkipped = 0;

    // Get parent backup path if needed
    const parentBackupPath = manifest.parent_backup
      ? `${this.storagePath}/backups/${manifest.parent_backup}`
      : null;

    // Reconstruct each file
    for (const file of manifest.files) {
      // Skip deleted files
      if (file.change_type === 'deleted') {
        filesSkipped++;
        continue;
      }

      // Determine source file location
      let sourceFilePath: string;
      if (file.source === 'current') {
        sourceFilePath = `${backupPath}/files/${file.file_hash}`;
      } else if (file.source === 'parent') {
        if (!parentBackupPath) {
          console.warn(`  ⚠️  File ${file.relative_path} references parent but no parent exists`);
          filesSkipped++;
          continue;
        }
        sourceFilePath = `${parentBackupPath}/files/${file.file_hash}`;
      } else {
        console.warn(`  ⚠️  Unknown source: ${file.source}`);
        filesSkipped++;
        continue;
      }

      // Check if source file exists
      const sourceExists = await exists(sourceFilePath);
      if (!sourceExists) {
        console.warn(`  ⚠️  Source file not found: ${sourceFilePath}`);
        filesSkipped++;
        continue;
      }

      // Create destination path
      const destPath = `${reconstructedPath}/${file.relative_path}`;
      const destDir = destPath.substring(0, destPath.lastIndexOf('/'));

      // Create directory structure
      await mkdir(destDir, { recursive: true });

      // Copy file (symlinks don't work well across platforms in Tauri)
      try {
        await copyFile(sourceFilePath, destPath);
        filesReconstructed++;
      } catch (error) {
        console.warn(`  ⚠️  Failed to copy ${file.relative_path}:`, error);
        filesSkipped++;
      }
    }

    console.log(`  ✅ Reconstructed ${filesReconstructed} files (${filesSkipped} skipped)`);
    console.log(`  📁 Location: ${reconstructedPath}`);

    return reconstructedPath;
  }
}

export const backupService = BackupService.getInstance();
