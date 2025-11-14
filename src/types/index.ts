export interface FileLink {
  id: string;
  name: string;
  path: string;
  size: number;
  type: 'file' | 'folder';
  backupUrl?: string; // URL to backed up version in cloud
  linkedFromSessionId?: string; // If this file is linked from another session
}

export interface Session {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  labels: string[];
  files: FileLink[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DayData {
  date: Date;
  sessions: Session[];
}
