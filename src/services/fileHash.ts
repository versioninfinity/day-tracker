/**
 * File Hashing Utility
 * Calculates SHA-256 hash for files and directories
 */

import { readDir, readFile, stat } from '@tauri-apps/plugin-fs';

export interface IndividualFileInfo {
  relativePath: string;
  hash: string;
  size: number;
  modifiedAt: Date | null;
}

export interface FileHashResult {
  hash: string;
  size: number;
  fileCount?: number; // For directories
  files?: IndividualFileInfo[]; // Individual file data for directories
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function hashFile(filePath: string): Promise<FileHashResult> {
  try {
    // Read file content
    const content = await readFile(filePath);

    // Calculate SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return {
      hash,
      size: content.length
    };
  } catch (error) {
    console.error('Error hashing file:', filePath, error);
    throw error;
  }
}

export type ProgressCallback = (current: number, total: number, fileName: string) => void;

/**
 * Recursively walk directory and collect all files
 */
async function walkDirectory(dirPath: string, basePath: string = dirPath): Promise<{
  path: string;
  relativePath: string;
}[]> {
  const files: { path: string; relativePath: string; }[] = [];

  try {
    const entries = await readDir(dirPath);

    for (const entry of entries) {
      if (!entry.name) continue;

      const fullPath = `${dirPath}/${entry.name}`;
      const relativePath = fullPath.substring(basePath.length + 1);

      try {
        const fileStats = await stat(fullPath);

        if (fileStats.isFile) {
          files.push({ path: fullPath, relativePath });
        } else if (fileStats.isDirectory) {
          // Recursively walk subdirectories
          const subFiles = await walkDirectory(fullPath, basePath);
          files.push(...subFiles);
        }
      } catch (error) {
        // Skip files we can't access
        console.warn('Skipping:', fullPath, error);
      }
    }
  } catch (error) {
    console.warn('Cannot read directory:', dirPath, error);
  }

  return files;
}

/**
 * Calculate hash of a directory by hashing all files
 * and combining their hashes
 */
export async function hashDirectory(
  dirPath: string,
  onProgress?: ProgressCallback
): Promise<FileHashResult> {
  try {
    // Recursively collect all files
    const allFiles = await walkDirectory(dirPath);

    // Sort for consistent hashing
    allFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    const fileHashes: string[] = [];
    const individualFiles: IndividualFileInfo[] = [];
    let totalSize = 0;
    let fileCount = 0;
    const totalFiles = allFiles.length;

    for (let i = 0; i < allFiles.length; i++) {
      const { path: fullPath, relativePath } = allFiles[i];

      // Report progress
      if (onProgress) {
        onProgress(i + 1, totalFiles, relativePath);
      }

      try {
        const result = await hashFile(fullPath);
        fileHashes.push(`${relativePath}:${result.hash}`);
        totalSize += result.size;
        fileCount++;

        // Get file modification time
        let modifiedAt: Date | null = null;
        try {
          const fileStats = await stat(fullPath);
          modifiedAt = fileStats.mtime ? new Date(fileStats.mtime) : null;
        } catch (statError) {
          // Ignore stat errors
        }

        // Store individual file info
        individualFiles.push({
          relativePath,
          hash: result.hash,
          size: result.size,
          modifiedAt
        });
      } catch (error) {
        console.warn('Skipping file:', fullPath, error);
      }
    }

    // Combine all file hashes into one
    const combined = fileHashes.join('|');
    const encoder = new TextEncoder();
    const data = encoder.encode(combined);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return {
      hash,
      size: totalSize,
      fileCount,
      files: individualFiles
    };
  } catch (error) {
    console.error('Error hashing directory:', dirPath, error);
    throw error;
  }
}

/**
 * Get file or directory hash
 * Auto-detects whether path is file or directory
 */
export async function getFileHash(
  path: string,
  onProgress?: ProgressCallback
): Promise<FileHashResult> {
  try {
    const metadata = await stat(path);

    if (metadata.isDirectory) {
      return await hashDirectory(path, onProgress);
    } else if (metadata.isFile) {
      return await hashFile(path);
    } else {
      throw new Error(`Unsupported file type: ${path}`);
    }
  } catch (error) {
    console.error('Error getting file hash:', path, error);
    throw error;
  }
}

/**
 * Get simple path hash (for use as unique ID)
 * Just hashes the path string itself
 */
export async function hashPath(path: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(path);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
