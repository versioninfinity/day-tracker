import { useState, useEffect } from 'react';
import { open, ask } from '@tauri-apps/plugin-dialog';
import { stat } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { storageService } from '../services/storage';

// Cloud sync configuration
// TODO: Replace with your Vercel API URL after deployment
const CLOUD_API_URL = 'https://your-api-url.vercel.app/api/sessions';
const ENABLE_CLOUD_SYNC = false; // Set to true after deploying API and updating URL above

interface TimeSlot {
  date: string; // ISO date string (YYYY-MM-DD)
  day: number; // 0-6 for Sun-Sat
  hour: number; // 0-23
  title?: string;
  labels?: string[];
  files?: FileLink[];
  notes?: string;
  startMinute?: number; // Actual start minute for the session
  endMinute?: number; // Actual end minute for the session
  startHour?: number; // Actual start hour for the session
  endHour?: number; // Actual end hour for the session
  column?: number; // Which column (0 or 1) this session belongs to
  sessionId?: string; // Unique ID for tracking files in database
}

interface SessionEdit {
  day: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  column: number; // Which column (0 or 1) this session belongs to
  sessionId: string; // Unique ID for this session
}

interface FileLink {
  id: string;
  name: string;
  path: string;
  size: number;
  type: 'file' | 'folder';
  hash?: string; // File content hash (from storage service)
  metadataId?: string; // ID in the file_metadata database table
  tracked?: boolean; // Whether this file has been tracked in the database
  backupName?: string; // Phase 5: Name of backup (e.g., "ucmas_2025-11-14_18-30")
  isFullBackup?: boolean; // Phase 5: Whether this is a full backup (true) or differential (false)
  parentMetadataId?: string; // Phase 5: ID of parent project for differential backups
}

interface LabelColor {
  name: string;
  color: string;
}

// Animated dots component for loading indicator
function AnimatedDots() {
  const [dots, setDots] = useState('.');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '.') return '..';
        if (prev === '..') return '...';
        return '.';
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return <span>{dots}</span>;
}

export default function SimpleCalendar() {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [dragStart, setDragStart] = useState<{ day: number; hour: number; minute: number; col: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ day: number; hour: number; minute: number; col: number } | null>(null);
  const [movingSession, setMovingSession] = useState<{ session: TimeSlot; offsetMinutes: number } | null>(null);
  const [editingSession, setEditingSession] = useState<SessionEdit | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionLabels, setSessionLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [allLabels, setAllLabels] = useState<string[]>(['Work', 'Personal', 'Meeting', 'Project']); // Sample labels
  const [labelColors, setLabelColors] = useState<LabelColor[]>([
    { name: 'Work', color: '#3B82F6' },
    { name: 'Personal', color: '#10B981' },
    { name: 'Meeting', color: '#F59E0B' },
    { name: 'Project', color: '#8B5CF6' },
  ]);
  const [sessionFiles, setSessionFiles] = useState<FileLink[]>([]);
  const [sessionNotes, setSessionNotes] = useState('');
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, -1 = previous week, +1 = next week
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isTimezoneConverting, setIsTimezoneConverting] = useState(false);
  const [fileTrackingProgress, setFileTrackingProgress] = useState<{
    isTracking: boolean;
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  // Phase 4: Project linking state
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [previousProjects, _setPreviousProjects] = useState<Array<{
    id: string;
    name: string;
    path: string;
    created_at: string;
  }>>([]);
  // Timezone selector
  const [selectedTimezone, setSelectedTimezone] = useState<string>(() => {
    const saved = localStorage.getItem('day-tracker-timezone');
    return saved || 'America/New_York'; // Default to ET
  });

  const timezones = [
    { value: 'America/New_York', label: 'ET', offset: -5 },
    { value: 'America/Chicago', label: 'CT', offset: -6 },
    { value: 'America/Denver', label: 'MT', offset: -7 },
    { value: 'America/Los_Angeles', label: 'PT', offset: -8 },
  ];

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Get current date info
  const today = new Date();

  // Merge contiguous sessions with the same title on the same day
  const mergeContiguousSessions = (slots: TimeSlot[]): TimeSlot[] => {
    const merged: TimeSlot[] = [];
    const slotsByDateAndTitle = new Map<string, TimeSlot[]>();

    // Group slots by date and title
    slots.forEach(slot => {
      if (!slot.title) {
        merged.push(slot);
        return;
      }
      const key = `${slot.date}_${slot.title}`;
      if (!slotsByDateAndTitle.has(key)) {
        slotsByDateAndTitle.set(key, []);
      }
      slotsByDateAndTitle.get(key)!.push(slot);
    });

    // For each group, sort by start time and merge contiguous sessions
    slotsByDateAndTitle.forEach((group, _key) => {
      // Sort by start time
      group.sort((a, b) => {
        const aStart = (a.startHour || a.hour) * 60 + (a.startMinute || 0);
        const bStart = (b.startHour || b.hour) * 60 + (b.startMinute || 0);
        return aStart - bStart;
      });

      let i = 0;
      while (i < group.length) {
        const current = group[i];
        let endHour = current.endHour!;
        let endMinute = current.endMinute!;

        // Try to merge with subsequent slots
        let j = i + 1;
        while (j < group.length) {
          const next = group[j];
          const currentEndMinutes = endHour * 60 + endMinute;
          const nextStartMinutes = (next.startHour || next.hour) * 60 + (next.startMinute || 0);

          // Check if they're contiguous (allowing 1 minute gap due to 23:59 → 00:00 split)
          if (nextStartMinutes - currentEndMinutes <= 1) {
            // Merge: extend end time to next's end time
            endHour = next.endHour!;
            endMinute = next.endMinute!;
            j++;
          } else {
            break;
          }
        }

        // Add merged slot
        merged.push({
          ...current,
          endHour,
          endMinute,
        });

        i = j;
      }
    });

    return merged;
  };

  // Load sessions from localStorage on mount
  useEffect(() => {
    const loadAndMigrate = async () => {
      try {
        const savedData = localStorage.getItem('day-tracker-sessions');
        const migrationDone = localStorage.getItem('day-tracker-migration-v2');
        const dbMigrationDone = localStorage.getItem('day-tracker-db-migration');

        // One-time migration: clear old UTC-formatted data
        if (savedData && !migrationDone) {
          console.log('Migrating from UTC dates to local dates - clearing old data');
          localStorage.removeItem('day-tracker-sessions');
          localStorage.setItem('day-tracker-migration-v2', 'done');
        } else if (savedData) {
          const data = JSON.parse(savedData);
          setSlots(data.slots || []);
          setAllLabels(data.allLabels || ['Work', 'Personal', 'Meeting', 'Project']);
          setLabelColors(data.labelColors || [
            { name: 'Work', color: '#3B82F6' },
            { name: 'Personal', color: '#10B981' },
            { name: 'Meeting', color: '#F59E0B' },
            { name: 'Project', color: '#8B5CF6' },
          ]);

          // Migration is handled by the save effect now with deterministic IDs
          // Mark as done to prevent re-running old migration logic
          if (!dbMigrationDone) {
            localStorage.setItem('day-tracker-db-migration', 'done');
          }
        }
      } catch (error) {
        console.error('Error loading sessions:', error);
      }
      setIsInitialLoad(false);
    };

    loadAndMigrate();
  }, []);

  // Save sessions to localStorage AND database whenever they change (but not on initial load)
  useEffect(() => {
    if (isInitialLoad || isTimezoneConverting) return;

    try {
      const data = {
        slots,
        allLabels,
        labelColors,
      };

      // Save to localStorage (primary storage)
      localStorage.setItem('day-tracker-sessions', JSON.stringify(data));
      console.log('Saved to localStorage:', data);

      // Save to database (backup storage) - skip during timezone conversion
      saveToDatabaseAsync(slots);

      // Also sync to cloud if enabled
      if (ENABLE_CLOUD_SYNC) {
        syncToCloud(data);
      }
    } catch (error) {
      console.error('Error saving sessions:', error);
    }
  }, [slots, allLabels, labelColors, isInitialLoad]);

  // Save timezone preference and convert all sessions when timezone changes
  useEffect(() => {
    const prevTimezone = localStorage.getItem('day-tracker-timezone');
    localStorage.setItem('day-tracker-timezone', selectedTimezone);

    // If timezone changed (not initial load), convert all existing sessions
    if (prevTimezone && prevTimezone !== selectedTimezone && slots.length > 0) {
      console.log(`🌍 Converting sessions from ${prevTimezone} to ${selectedTimezone}...`);
      setIsTimezoneConverting(true);

      const convertedSlots: TimeSlot[] = [];

      slots.forEach(slot => {
        if (!slot.title || !slot.date) {
          convertedSlots.push(slot);
          return;
        }

        // Parse the current slot time
        const startHour = slot.startHour !== undefined ? slot.startHour : slot.hour;
        const startMinute = slot.startMinute !== undefined ? slot.startMinute : 0;
        const endHour = slot.endHour !== undefined ? slot.endHour : slot.hour + 1;
        const endMinute = slot.endMinute !== undefined ? slot.endMinute : 0;

        // Create date objects in the OLD timezone
        const oldDate = new Date(slot.date + 'T00:00:00');
        const startDate = new Date(oldDate);
        startDate.setHours(startHour, startMinute, 0, 0);
        const endDate = new Date(oldDate);
        endDate.setHours(endHour, endMinute, 0, 0);

        // Convert from old timezone to UTC, then to new timezone
        // This is a simplified approach - we calculate the offset difference
        const oldTz = timezones.find(tz => tz.value === prevTimezone);
        const newTz = timezones.find(tz => tz.value === selectedTimezone);

        if (oldTz && newTz) {
          const offsetDiff = newTz.offset - oldTz.offset; // Hours difference

          // Shift times - this handles day boundary crossing automatically
          const newStartDate = new Date(startDate.getTime() + offsetDiff * 60 * 60 * 1000);
          const newEndDate = new Date(endDate.getTime() + offsetDiff * 60 * 60 * 1000);

          // Check if session crosses midnight after timezone shift
          const startDateStr = getLocalDateString(newStartDate);
          const endDateStr = getLocalDateString(newEndDate);

          if (startDateStr === endDateStr) {
            // Session stays within one day
            convertedSlots.push({
              ...slot,
              date: startDateStr,
              day: newStartDate.getDay(),
              hour: newStartDate.getHours(),
              startHour: newStartDate.getHours(),
              startMinute: newStartDate.getMinutes(),
              endHour: newEndDate.getHours(),
              endMinute: newEndDate.getMinutes(),
            });
          } else {
            // Session crosses midnight - split into two slots
            // First part: from start to 23:59:59 on start day
            convertedSlots.push({
              ...slot,
              date: startDateStr,
              day: newStartDate.getDay(),
              hour: newStartDate.getHours(),
              startHour: newStartDate.getHours(),
              startMinute: newStartDate.getMinutes(),
              endHour: 23,
              endMinute: 59,
            });

            // Second part: from 00:00 to end on next day
            convertedSlots.push({
              ...slot,
              date: endDateStr,
              day: newEndDate.getDay(),
              hour: 0,
              startHour: 0,
              startMinute: 0,
              endHour: newEndDate.getHours(),
              endMinute: newEndDate.getMinutes(),
            });
          }
        } else {
          convertedSlots.push(slot);
        }
      });

      const mergedSlots = mergeContiguousSessions(convertedSlots);
      setSlots(mergedSlots);
      console.log(`✅ Converted ${slots.length} sessions into ${convertedSlots.length} slots, merged to ${mergedSlots.length}`);

      // Reset flag after conversion to allow normal saves
      setTimeout(() => setIsTimezoneConverting(false), 100);
    }
  }, [selectedTimezone]);

  // Cloud sync functions
  const syncToCloud = async (data: { slots: TimeSlot[], allLabels: string[], labelColors: LabelColor[] }) => {
    try {
      const response = await fetch(CLOUD_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`Cloud sync failed: ${response.statusText}`);
      }

      console.log('✅ Synced to cloud successfully');
    } catch (error) {
      console.error('❌ Cloud sync error:', error);
      // Don't throw - we don't want to break the app if cloud sync fails
    }
  };

  // Generate consistent session ID based on session properties
  const generateSessionId = (slot: TimeSlot): string => {
    const startHour = slot.startHour !== undefined ? slot.startHour : slot.hour;
    const startMinute = slot.startMinute !== undefined ? slot.startMinute : 0;
    const endHour = slot.endHour !== undefined ? slot.endHour : slot.hour + 1;
    const endMinute = slot.endMinute !== undefined ? slot.endMinute : 0;

    // Create a deterministic ID based on date, time, and title (NOT column, so moving doesn't create duplicates)
    const key = `${slot.date}_${startHour}:${startMinute}_${endHour}:${endMinute}_${slot.title}`;

    // Simple hash function to convert string to UUID-like format
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to hex and pad to create a UUID-like string
    const hashHex = Math.abs(hash).toString(16).padStart(8, '0');
    return `${hashHex}-${slot.date.replace(/-/g, '')}-${startHour}${startMinute}-${endHour}${endMinute}`;
  };

  // Database sync function - save sessions to SQLite
  const saveToDatabaseAsync = async (slots: TimeSlot[]) => {
    if (!storageService.isInitialized()) {
      console.warn('⚠️  Storage service not initialized, skipping database save');
      return;
    }

    try {
      // Convert TimeSlot format to database format
      const sessionsToSave = slots
        .filter(slot => slot.title) // Only save slots with titles (actual sessions)
        .map(slot => ({
          id: generateSessionId(slot), // Use deterministic ID to prevent duplicates
          title: slot.title!,
          date: slot.date,
          startHour: slot.startHour !== undefined ? slot.startHour : slot.hour,
          startMinute: slot.startMinute !== undefined ? slot.startMinute : 0,
          endHour: slot.endHour !== undefined ? slot.endHour : slot.hour + 1,
          endMinute: slot.endMinute !== undefined ? slot.endMinute : 0,
          labels: slot.labels || [],
          notes: slot.notes || '',
          column: slot.column || 0,
        }));

      if (sessionsToSave.length > 0) {
        await storageService.saveSessions(sessionsToSave);
        console.log(`💾 Saved ${sessionsToSave.length} sessions to database`);
      }
    } catch (error) {
      console.error('❌ Database save error:', error);
      // Don't throw - we don't want to break the app if database save fails
    }
  };

  // Restore sessions from database to localStorage
  const syncFromDatabase = async () => {
    if (!storageService.isInitialized()) {
      alert('Storage service not initialized');
      return;
    }

    try {
      const confirmed = await ask('Restore sessions from database? This will replace your current sessions in the calendar view.', {
        title: 'Restore from Database',
        kind: 'info',
      });
      if (!confirmed) return;

      console.log('📥 Loading sessions from database...');
      const dbSessions = await storageService.loadSessions();

      // Convert database format to TimeSlot format (UTC -> selected timezone)
      const restoredSlots: TimeSlot[] = await Promise.all(
        dbSessions.map(async session => {
          const utcStart = new Date(session.start_time);
          const utcEnd = new Date(session.end_time);

          // Convert UTC to selected timezone
          const startTime = convertUTCToTimezone(utcStart);
          const endTime = convertUTCToTimezone(utcEnd);

          // Restore linked files for this session
          const sessionFiles = await storageService.getSessionFiles(session.id);
          const files = sessionFiles.map(fileMetadata => ({
            id: fileMetadata.id,
            name: fileMetadata.file_name,
            path: fileMetadata.file_path,
            size: fileMetadata.file_size || 0,
            type: fileMetadata.file_type as 'file' | 'folder',
            hash: fileMetadata.file_hash || undefined,
            metadataId: fileMetadata.id,
            tracked: true,
            backupName: fileMetadata.backup_name || undefined,
            isFullBackup: fileMetadata.is_full_backup === 1,
          }));

          return {
            date: getLocalDateString(startTime),
            day: startTime.getDay(),
            hour: startTime.getHours(),
            title: session.title,
            labels: session.labels,
            notes: session.notes,
            startMinute: startTime.getMinutes(),
            endMinute: endTime.getMinutes(),
            startHour: startTime.getHours(),
            endHour: endTime.getHours(),
            column: session.column_index || 0,
            sessionId: session.id,
            files,
          };
        })
      );

      console.log('📦 Restored slots:', restoredSlots);
      setSlots(restoredSlots);
      console.log(`✅ Restored ${restoredSlots.length} sessions from database`);
      alert(`Successfully restored ${restoredSlots.length} sessions from database!`);
    } catch (error) {
      console.error('❌ Database restore error:', error);
      alert('Failed to restore sessions from database. Check console for details.');
    }
  };

  // Helper to get local date string (YYYY-MM-DD) without timezone conversion
  const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Convert UTC date to selected timezone
  const convertUTCToTimezone = (utcDate: Date): Date => {
    return new Date(utcDate.toLocaleString('en-US', { timeZone: selectedTimezone }));
  };

  // Calculate dates for the week starting from Sunday
  const getWeekDates = () => {
    const today = new Date();
    const curr = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    curr.setDate(curr.getDate() + (weekOffset * 7)); // Apply week offset
    const dayOfWeek = curr.getDay(); // 0 = Sunday, 6 = Saturday
    const firstDayOfWeek = new Date(curr);
    firstDayOfWeek.setDate(curr.getDate() - dayOfWeek); // Go back to Sunday

    return days.map((_, i) => {
      const date = new Date(firstDayOfWeek);
      date.setDate(firstDayOfWeek.getDate() + i);
      return date;
    });
  };

  const weekDates = getWeekDates();

  // Get the month and year from the first date of the current week
  const currentMonth = weekDates[0].toLocaleDateString('en-US', { month: 'long' });
  const currentYear = weekDates[0].getFullYear();

  const goToPreviousWeek = () => {
    setWeekOffset(weekOffset - 1);
  };

  const goToNextWeek = () => {
    setWeekOffset(weekOffset + 1);
  };

  const goToToday = () => {
    setWeekOffset(0);
  };

  // Get current time info for the red line
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const handleCellMouseDown = (day: number, hour: number, col: number, row: number, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Calculate minute based on row (4 rows = 15 min each)
    const minute = row * 15;
    console.log('Cell mouse down:', day, hour, minute, 'col:', col, 'row:', row);

    // Check if there's a session in THIS specific cell (column + time range)
    const dateString = getLocalDateString(weekDates[day]);
    const cellStartMinutes = hour * 60 + minute;
    const cellEndMinutes = cellStartMinutes + 15; // Each cell is 15 minutes

    console.log('Checking for session at:', { dateString, day, hour, minute, col, cellStartMinutes, cellEndMinutes });
    console.log('All slots:', slots);

    const existingSessionInCell = slots.find(s => {
      if (s.date !== dateString || s.day !== day || s.column !== col) return false;

      // If this slot has detailed time info, check for overlap
      if (s.startHour !== undefined && s.startMinute !== undefined &&
          s.endHour !== undefined && s.endMinute !== undefined) {
        const sessionStartMinutes = s.startHour * 60 + s.startMinute;
        const sessionEndMinutes = s.endHour * 60 + s.endMinute;

        const overlaps = cellStartMinutes < sessionEndMinutes && cellEndMinutes > sessionStartMinutes;
        console.log('Checking slot with times:', s, 'overlaps:', overlaps);
        return overlaps;
      }

      // Fallback: if no detailed time info, just check if the hour matches
      const overlaps = s.hour === hour;
      console.log('Checking slot without times (hour-based):', s, 'overlaps:', overlaps);
      return overlaps;
    });

    console.log('Found session:', existingSessionInCell);

    // If clicking on existing session, start tracking for drag-to-move
    if (existingSessionInCell) {
      // Calculate offset from session start to where we clicked
      const sessionStartMinutes = (existingSessionInCell.startHour ?? hour) * 60 + (existingSessionInCell.startMinute ?? 0);
      const clickMinutes = hour * 60 + minute;
      const offsetMinutes = clickMinutes - sessionStartMinutes;

      setMovingSession({
        session: existingSessionInCell,
        offsetMinutes
      });
      setDragStart({ day, hour, minute, col });
      setDragEnd({ day, hour, minute, col });
      return;
    }

    // Otherwise start creating new session - include column info
    setDragStart({ day, hour, minute, col });
    setDragEnd({ day, hour, minute, col });
  };

  const handleCellMouseEnter = (day: number, hour: number, col: number, row: number, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (dragStart) {
      const minute = row * 15;

      // If moving a session, allow moving to different days/columns
      if (movingSession) {
        setDragEnd({ day, hour, minute, col });
      }
      // If creating new session, only allow dragging in same day/column
      else if (dragStart.day === day && dragStart.col === col) {
        setDragEnd({ day, hour, minute, col });
      }
    }
  };

  const handleCellMouseUp = (day: number, hour: number, col: number, row: number, e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const minute = row * 15;
    console.log('Cell mouse up:', day, hour, minute, 'col:', col, 'row:', row);

    // Handle moving an existing session
    if (movingSession && dragStart && dragEnd) {
      const hasMoved = dragStart.day !== dragEnd.day ||
                      dragStart.hour !== dragEnd.hour ||
                      dragStart.minute !== dragEnd.minute ||
                      dragStart.col !== dragEnd.col;

      if (hasMoved) {
        // Move the session to new location
        const session = movingSession.session;
        const sessionDuration = ((session.endHour ?? 0) * 60 + (session.endMinute ?? 0)) -
                               ((session.startHour ?? 0) * 60 + (session.startMinute ?? 0));

        // Calculate new start time (current mouse position minus the offset)
        const clickMinutes = dragEnd.hour * 60 + dragEnd.minute;
        const newStartMinutes = clickMinutes - movingSession.offsetMinutes;
        const newEndMinutes = newStartMinutes + sessionDuration;

        const newStartHour = Math.floor(newStartMinutes / 60);
        const newStartMinute = newStartMinutes % 60;
        const newEndHour = Math.floor(newEndMinutes / 60);
        const newEndMinute = newEndMinutes % 60;

        // Get the date string for the new day
        const newDateString = getLocalDateString(weekDates[dragEnd.day]);

        // Remove old slots for this session
        const filteredSlots = slots.filter(s => s.title !== session.title || s.date !== session.date || s.column !== session.column);

        // Create new slots for the moved session
        const newSlots: TimeSlot[] = [];
        const startHourForSlots = newStartHour;
        let endHourForSlots = newEndHour;
        if (newEndMinute === 0 && newEndHour > newStartHour) {
          endHourForSlots = newEndHour;
        } else {
          endHourForSlots = newEndHour + 1;
        }

        for (let h = startHourForSlots; h < endHourForSlots; h++) {
          newSlots.push({
            date: newDateString,
            day: dragEnd.day,
            hour: h,
            title: session.title,
            labels: session.labels,
            files: session.files,
            notes: session.notes,
            startHour: newStartHour,
            startMinute: newStartMinute,
            endHour: newEndHour,
            endMinute: newEndMinute,
            column: dragEnd.col,
            sessionId: session.sessionId, // Preserve session ID when moving
          });
        }

        setSlots([...filteredSlots, ...newSlots]);
      } else {
        // Just clicked (no drag), open edit mode
        const session = movingSession.session;
        setEditingSession({
          day: session.day,
          startHour: session.startHour ?? 0,
          startMinute: session.startMinute ?? 0,
          endHour: session.endHour ?? 1,
          endMinute: session.endMinute ?? 0,
          column: session.column ?? 0,
          sessionId: session.sessionId ?? crypto.randomUUID(), // Use existing or create new
        });
        setSessionTitle(session.title || '');
        setSessionLabels(session.labels || []);
        setSessionFiles(session.files || []);
        setSessionNotes(session.notes || '');
      }

      // Clear moving state
      setMovingSession(null);
      setDragStart(null);
      setDragEnd(null);
      return;
    }

    // Handle creating new session
    if (dragStart && dragStart.col === col) {
      // Calculate start and end times (add 15 min to end to include the full cell)
      const startTotalMinutes = dragStart.hour * 60 + dragStart.minute;
      const endTotalMinutes = hour * 60 + minute + 15;

      const isReverse = endTotalMinutes < startTotalMinutes;
      const minTotalMinutes = isReverse ? endTotalMinutes - 15 : startTotalMinutes;
      const maxTotalMinutes = isReverse ? startTotalMinutes + 15 : endTotalMinutes;

      const startHour = Math.floor(minTotalMinutes / 60);
      const startMinute = minTotalMinutes % 60;
      const endHour = Math.floor(maxTotalMinutes / 60);
      const endMinute = maxTotalMinutes % 60;

      // Open the edit panel
      setEditingSession({
        day: dragStart.day,
        startHour,
        startMinute,
        endHour,
        endMinute,
        column: dragStart.col,
        sessionId: crypto.randomUUID(), // Generate new session ID
      });
      setSessionTitle('');
      setSessionLabels([]);
      setSessionFiles([]);
      setSessionNotes('');
      setNewLabel('');

      // Clear the drag state
      setDragStart(null);
      setDragEnd(null);
    }
  };

  const handleSaveSession = () => {
    if (editingSession && sessionTitle.trim()) {
      // Validate that end time is after start time
      const startMinutes = editingSession.startHour * 60 + editingSession.startMinute;
      const endMinutes = editingSession.endHour * 60 + editingSession.endMinute;

      if (endMinutes <= startMinutes) {
        alert('End time must be after start time');
        return;
      }

      const sessionDate = weekDates[editingSession.day];
      const dateString = getLocalDateString(sessionDate); // YYYY-MM-DD

      // Remove old slots for this session (if editing)
      const filteredSlots = slots.filter(s => {
        if (s.date === dateString && s.day === editingSession.day && s.column === editingSession.column) {
          // Check if this slot is part of the session being edited (same column, same title)
          return s.title !== sessionTitle.trim();
        }
        return true;
      });

      const newSlots: TimeSlot[] = [];
      // Calculate which hours this session spans
      let startHourForSlots = editingSession.startHour;
      let endHourForSlots = editingSession.endHour;

      // If end minute is 0, we don't need to include the end hour
      if (editingSession.endMinute === 0 && editingSession.endHour > editingSession.startHour) {
        endHourForSlots = editingSession.endHour;
      } else {
        endHourForSlots = editingSession.endHour + 1;
      }

      for (let h = startHourForSlots; h < endHourForSlots; h++) {
        newSlots.push({
          date: dateString,
          day: editingSession.day,
          hour: h,
          title: sessionTitle.trim(),
          labels: sessionLabels.length > 0 ? sessionLabels : undefined,
          files: sessionFiles.length > 0 ? sessionFiles : undefined,
          notes: sessionNotes.trim() || undefined,
          startHour: editingSession.startHour,
          startMinute: editingSession.startMinute,
          endHour: editingSession.endHour,
          endMinute: editingSession.endMinute,
          column: editingSession.column,
          sessionId: editingSession.sessionId, // Include session ID
        });
      }
      setSlots([...filteredSlots, ...newSlots]);
      setEditingSession(null);
      setSessionTitle('');
      setSessionLabels([]);
      setSessionFiles([]);
      setSessionNotes('');
    }
  };

  const handleDeleteSession = async () => {
    if (editingSession && sessionTitle.trim()) {
      const sessionDate = weekDates[editingSession.day];
      const dateString = getLocalDateString(sessionDate);

      // Delete all file metadata for this session from database
      if (storageService.isInitialized()) {
        try {
          await storageService.deleteSessionFiles(editingSession.sessionId);
          console.log(`✅ Deleted all files for session from database`);
        } catch (error) {
          console.error('⚠️  Failed to delete session files from database:', error);
        }
      }

      // Remove all slots for this session (in the same column)
      const filteredSlots = slots.filter(s => {
        if (s.date === dateString && s.day === editingSession.day && s.column === editingSession.column && s.title === sessionTitle.trim()) {
          return false;
        }
        return true;
      });

      setSlots(filteredSlots);
      setEditingSession(null);
      setSessionTitle('');
      setSessionLabels([]);
      setSessionFiles([]);
      setSessionNotes('');
    }
  };

  const handleCancelSession = () => {
    setEditingSession(null);
    setSessionTitle('');
    setSessionLabels([]);
    setSessionFiles([]);
    setSessionNotes('');
    setNewLabel('');
  };

  const handleAddLabel = () => {
    if (newLabel.trim() && !sessionLabels.includes(newLabel.trim())) {
      setSessionLabels([...sessionLabels, newLabel.trim()]);
      if (!allLabels.includes(newLabel.trim())) {
        setAllLabels([...allLabels, newLabel.trim()]);
        // Add a default color for new labels
        const defaultColors = ['#EF4444', '#F97316', '#84CC16', '#06B6D4', '#6366F1', '#EC4899'];
        const newColor = defaultColors[labelColors.length % defaultColors.length];
        setLabelColors([...labelColors, { name: newLabel.trim(), color: newColor }]);
      }
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (label: string) => {
    setSessionLabels(sessionLabels.filter(l => l !== label));
  };

  const getLabelColor = (labelName: string): string => {
    const labelColor = labelColors.find(lc => lc.name === labelName);
    return labelColor ? labelColor.color : '#6B7280';
  };

  const getSlotColor = (slot: TimeSlot | undefined): string => {
    if (!slot || !slot.labels || slot.labels.length === 0) {
      return '#34D399'; // Default green
    }
    // Use the first label's color
    return getLabelColor(slot.labels[0]);
  };

  const handleUpdateLabelColor = (labelName: string, newColor: string) => {
    setLabelColors(labelColors.map(lc =>
      lc.name === labelName ? { ...lc, color: newColor } : lc
    ));
  };

  const handleAddFiles = async () => {
    if (!editingSession) return;

    try {
      const selected = await open({
        multiple: true,
        directory: false,
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const newFiles: FileLink[] = [];

        for (const path of paths) {
          try {
            const fileName = path.split('/').pop() || path;
            const metadata = await stat(path);

            // Track file in database
            let fileHash: string | undefined;
            let metadataId: string | undefined;
            let tracked = false;
            let backupName: string | undefined;
            let isFullBackup: boolean | undefined;

            // Only track if storage service is initialized
            if (storageService.isInitialized()) {
              try {
                // Set loading state for this file
                setFileTrackingProgress({
                  isTracking: true,
                  current: 0,
                  total: 1,
                  fileName: `Backing up ${fileName}...`,
                });

                const fileMetadata = await storageService.trackFile(editingSession.sessionId, path);
                fileHash = fileMetadata.file_hash || undefined;
                metadataId = fileMetadata.id;
                tracked = true;
                backupName = fileMetadata.backup_name || undefined;
                isFullBackup = fileMetadata.is_full_backup === 1;
                console.log(`✅ Tracked file: ${fileMetadata.file_name} (${fileMetadata.file_hash?.substring(0, 12)}...)`);
                if (backupName) {
                  console.log(`   💾 Backup: ${backupName}`);
                }

                // Clear loading state
                setFileTrackingProgress(null);
              } catch (trackError) {
                console.warn('⚠️  Could not track file in database:', trackError);
                setFileTrackingProgress(null);
              }
            } else {
              console.warn('⚠️  Storage service not initialized - file will be linked but not tracked');
            }

            newFiles.push({
              id: crypto.randomUUID(),
              name: fileName,
              path,
              size: metadata.size,
              type: 'file',
              hash: fileHash,
              metadataId,
              tracked,
              backupName,
              isFullBackup,
            });
          } catch (error) {
            console.error('Error reading file metadata:', error);
            setFileTrackingProgress(null);
          }
        }

        setSessionFiles([...sessionFiles, ...newFiles]);
      }
    } catch (error) {
      console.error('Error selecting files:', error);
      setFileTrackingProgress(null);
    }
  };

  const handleAddFolder = async () => {
    if (!editingSession) return;

    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (selected && typeof selected === 'string') {
        // Track folder in database
        let fileHash: string | undefined;
        let metadataId: string | undefined;
        let tracked = false;
        let backupName: string | undefined;
        let isFullBackup: boolean | undefined;

        // Only track if storage service is initialized
        if (storageService.isInitialized()) {
          try {
            const folderName = selected.split('/').pop() || selected;

            // Set loading state for copying
            setFileTrackingProgress({
              isTracking: true,
              current: 0,
              total: 1,
              fileName: `Copying ${folderName}...`,
            });

            // Track file (will copy folder with rsync)
            const fileMetadata = await storageService.trackFile(
              editingSession.sessionId,
              selected
            );

            fileHash = fileMetadata.file_hash || undefined;
            metadataId = fileMetadata.id;
            tracked = true;
            backupName = fileMetadata.backup_name || undefined;
            isFullBackup = fileMetadata.is_full_backup === 1;
            console.log(`✅ Tracked folder: ${fileMetadata.file_name}`);
            if (backupName) {
              console.log(`   💾 Backup: ${backupName}`);
            }

            // Clear loading state
            setFileTrackingProgress(null);
          } catch (trackError) {
            console.warn('⚠️  Could not track folder in database:', trackError);
            setFileTrackingProgress(null);
          }
        } else {
          console.warn('⚠️  Storage service not initialized - folder will be linked but not tracked');
        }

        setSessionFiles([
          ...sessionFiles,
          {
            id: crypto.randomUUID(),
            name: selected.split('/').pop() || selected,
            path: selected,
            size: 0,
            type: 'folder',
            hash: fileHash,
            metadataId,
            tracked,
            backupName,
            isFullBackup,
          },
        ]);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
      setFileTrackingProgress(null);
    }
  };

  const handleSelectPreviousProject = async (parentId: string) => {
    if (!editingSession) return;

    try {
      setShowLinkDialog(false);

      // Show folder picker
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (selected && typeof selected === 'string') {
        let fileHash: string | undefined;
        let metadataId: string | undefined;
        let tracked = false;
        let backupName: string | undefined;
        let isFullBackup: boolean | undefined;

        // Track folder with parent link
        if (storageService.isInitialized()) {
          try {
            setFileTrackingProgress({
              isTracking: true,
              current: 0,
              total: 0,
              fileName: 'Scanning...',
            });

            // Track file with parent metadata ID (creates differential backup)
            const fileMetadata = await storageService.trackFile(
              editingSession.sessionId,
              selected,
              (current, total, fileName) => {
                setFileTrackingProgress({
                  isTracking: true,
                  current,
                  total,
                  fileName,
                });
              },
              parentId  // Link to parent project
            );

            fileHash = fileMetadata.file_hash || undefined;
            metadataId = fileMetadata.id;
            tracked = true;
            backupName = fileMetadata.backup_name || undefined;
            isFullBackup = fileMetadata.is_full_backup === 1;
            console.log(`✅ Linked folder to parent: ${fileMetadata.file_name}`);
            if (backupName) {
              console.log(`   💾 Differential backup: ${backupName}`);
            }

            setFileTrackingProgress(null);
          } catch (trackError) {
            console.warn('⚠️  Could not track folder in database:', trackError);
            setFileTrackingProgress(null);
          }
        }

        setSessionFiles([
          ...sessionFiles,
          {
            id: crypto.randomUUID(),
            name: selected.split('/').pop() || selected,
            path: selected,
            size: 0,
            type: 'folder',
            hash: fileHash,
            metadataId,
            tracked,
            backupName,
            isFullBackup,
            parentMetadataId: parentId,
          },
        ]);
      }
    } catch (error) {
      console.error('Error linking to previous project:', error);
      setFileTrackingProgress(null);
    }
  };

  const handleRemoveFile = async (fileId: string) => {
    // Find the file to get its metadataId
    const fileToRemove = sessionFiles.find(f => f.id === fileId);

    // Remove from UI
    setSessionFiles(sessionFiles.filter(f => f.id !== fileId));

    // Delete from database if it was tracked
    if (fileToRemove?.metadataId && storageService.isInitialized()) {
      try {
        await storageService.deleteFileMetadata(fileToRemove.metadataId);
        console.log(`✅ Deleted file metadata from database`);
      } catch (error) {
        console.error('⚠️  Failed to delete file metadata from database:', error);
      }
    }
  };

  const handleOpenFile = async (filePath: string) => {
    try {
      await openPath(filePath);
    } catch (error) {
      console.error('Error opening file/folder:', error);
    }
  };

  // Open backup folder directly (simple folder copy)
  const handleOpenBackup = async (backupName: string) => {
    try {
      console.log(`📸 Opening backup: ${backupName}`);

      // Get storage path from storage service
      const storagePath = storageService.getStoragePath();
      const backupPath = `${storagePath}/backups/${backupName}`;

      await openPath(backupPath);

      console.log(`✅ Opened backup at: ${backupPath}`);
    } catch (error) {
      console.error('❌ Failed to open backup:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return 'Folder';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const isDragging = (day: number, hour: number) => {
    if (!dragStart || !dragEnd || dragStart.day !== day) return false;
    const startMinutes = dragStart.hour * 60 + dragStart.minute;
    const endMinutes = dragEnd.hour * 60 + dragEnd.minute;
    const min = Math.min(startMinutes, endMinutes);
    const max = Math.max(startMinutes, endMinutes);
    const hourStartMinutes = hour * 60;
    const hourEndMinutes = (hour + 1) * 60 - 1;
    return hourStartMinutes <= max && hourEndMinutes >= min;
  };

  // Get all sessions that overlap with any part of an hour cell
  const getOverlappingSlotsInHour = (day: number, hour: number): TimeSlot[] => {
    const dateString = getLocalDateString(weekDates[day]);
    const hourStartMinutes = hour * 60;
    const hourEndMinutes = (hour + 1) * 60;

    // Get all unique sessions (by title) for this day
    const daySessions = slots.filter(s => s.date === dateString && s.day === day);
    const uniqueSessions = new Map<string, TimeSlot>();

    daySessions.forEach(slot => {
      if (slot.title && !uniqueSessions.has(slot.title)) {
        uniqueSessions.set(slot.title, slot);
      }
    });

    // Find sessions that overlap with any part of this hour
    const overlapping: TimeSlot[] = [];
    uniqueSessions.forEach(session => {
      if (session.startHour !== undefined && session.startMinute !== undefined &&
          session.endHour !== undefined && session.endMinute !== undefined) {
        const sessionStartMinutes = session.startHour * 60 + session.startMinute;
        const sessionEndMinutes = session.endHour * 60 + session.endMinute;

        // Check if session overlaps with this hour at all
        if (sessionStartMinutes < hourEndMinutes && sessionEndMinutes > hourStartMinutes) {
          overlapping.push(session);
        }
      }
    });

    return overlapping.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Left side - Calendar */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with month/year and navigation */}
        <div className="px-6 py-4 bg-white" style={{ borderBottom: '1px solid #F3F4F6' }}>
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">{currentMonth} {currentYear}</h1>
            <div className="flex items-center gap-3">
              <button onClick={goToPreviousWeek} className="text-2xl text-gray-600 hover:text-gray-900">‹</button>
              <button onClick={goToToday} className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Today</button>
              <button onClick={goToNextWeek} className="text-2xl text-gray-600 hover:text-gray-900">›</button>

              {/* Timezone selector */}
              <select
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value)}
                className="ml-4 px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Select timezone"
              >
                {timezones.map(tz => (
                  <option key={tz.value} value={tz.value}>
                    🌍 {tz.label}
                  </option>
                ))}
              </select>

              <button
                onClick={syncFromDatabase}
                className="ml-2 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-300"
                title="Restore sessions from database backup"
              >
                💾 Sync from DB
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div>
            {/* Day Headers */}
            <div style={{ display: 'flex', backgroundColor: 'white', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ width: '128px', flexShrink: 0 }}></div>
              {days.map((_, i) => {
                const date = weekDates[i];
                const isToday = date.toDateString() === today.toDateString();
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      minWidth: '120px',
                      padding: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      borderRight: '1px solid #F3F4F6',
                      boxSizing: 'border-box'
                    }}
                  >
                    <span className="text-xs text-gray-500 font-medium">
                      {days[i].slice(0, 3)}
                    </span>
                    {isToday ? (
                      <div className="w-7 h-7 flex items-center justify-center bg-red-500 text-white rounded-full text-sm font-semibold">
                        {date.getDate()}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500 font-medium">
                        {date.getDate()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

        {/* Grid */}
        {hours.map((hour) => {
          const isPM = hour >= 12;
          const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
          const period = isPM ? 'PM' : 'AM';

          return (
            <div key={hour} style={{ display: 'flex' }}>
              {/* Time label */}
              <div style={{
                width: '128px',
                flexShrink: 0,
                backgroundColor: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '60px'
              }}>
                <span className="text-sm text-gray-700 font-medium inline-block text-right" style={{ width: '16px' }}>{displayHour}</span>
                <span className="text-xs text-gray-400 ml-1">{period}</span>
              </div>

              {/* Day cells */}
              {days.map((_, dayIdx) => {
                const isDrag = isDragging(dayIdx, hour);
                const isTodayColumn = weekDates[dayIdx].toDateString() === today.toDateString();

                // Get all overlapping sessions in this hour
                const overlappingSessions = getOverlappingSlotsInHour(dayIdx, hour);

                // Check if current time line should be in this cell
                const shouldShowTimeLine = isTodayColumn && currentHour === hour;
                const timeLinePosition = shouldShowTimeLine ? (currentMinute / 60) * 60 : null; // Position in pixels from top of cell

                return (
                  <div
                    key={dayIdx}
                    style={{
                      position: 'relative',
                      flex: 1,
                      minWidth: '120px',
                      height: '60px',
                      borderRight: '1px solid #F3F4F6',
                      borderBottom: '2px solid #F3F4F6',
                      boxSizing: 'border-box',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gridTemplateRows: 'repeat(4, 1fr)',
                      gap: '1px',
                      backgroundColor: '#F3F4F6',
                      padding: '1px',
                      gridAutoFlow: 'column'
                    }}
                  >
                    {/* 8 grid cells: 2 columns x 4 rows */}
                    {([0, 1] as const).map((col) =>
                      ([0, 1, 2, 3] as const).map((row) => {
                        // Check if this specific cell is in the drag selection
                        const cellMinute = row * 15;
                        const isCellInDrag = dragStart && dragEnd &&
                          dragStart.day === dayIdx &&
                          dragEnd.day === dayIdx &&
                          dragEnd.col === col &&
                          (() => {
                            // When moving between columns, only show preview at destination
                            if (movingSession && dragStart.col !== dragEnd.col) {
                              // Show the full session duration at the destination column
                              const destStart = dragEnd.hour * 60 + dragEnd.minute;
                              const destEnd = destStart + (movingSession.session.endMinute! - movingSession.session.startMinute! + (movingSession.session.endHour! - movingSession.session.startHour!) * 60);
                              const cellStart = hour * 60 + cellMinute;
                              const cellEnd = cellStart + 15;
                              return cellStart < destEnd && cellEnd > destStart;
                            }
                            // Normal same-column drag
                            const startMin = Math.min(dragStart.hour * 60 + dragStart.minute, dragEnd.hour * 60 + dragEnd.minute);
                            const endMin = Math.max(dragStart.hour * 60 + dragStart.minute, dragEnd.hour * 60 + dragEnd.minute) + 15;
                            const cellStart = hour * 60 + cellMinute;
                            const cellEnd = cellStart + 15;
                            return cellStart < endMin && cellEnd > startMin;
                          })();

                        return (
                          <div
                            key={`${col}-${row}`}
                            className="cursor-pointer select-none"
                            onMouseDown={(e) => handleCellMouseDown(dayIdx, hour, col, row, e)}
                            onMouseEnter={(e) => handleCellMouseEnter(dayIdx, hour, col, row, e)}
                            onMouseUp={(e) => handleCellMouseUp(dayIdx, hour, col, row, e)}
                            style={{
                              backgroundColor: isCellInDrag ? '#DBEAFE' : '#FFFFFF',
                              transition: 'background-color 0.1s',
                            }}
                          />
                        );
                      })
                    )}

                    {/* Overlay container for sessions */}
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      pointerEvents: 'none'
                    }}
                  >
                    {/* Render all overlapping sessions */}
                    {!isDrag && overlappingSessions.map((slot, sessionIndex) => {
                      // Check if this session is being moved
                      const isBeingMoved = movingSession &&
                        slot.title === movingSession.session.title &&
                        slot.date === movingSession.session.date &&
                        slot.column === movingSession.session.column;

                      // Calculate position for this session based on its column
                      const sessionColumn = slot.column ?? 0;
                      const sessionWidth = 50; // Always 50% (one column)
                      const sessionLeft = sessionColumn * 50; // 0% for column 0, 50% for column 1

                      // Check if this is the first hour of this session
                      const prevHourSessions = hour > 0 ? getOverlappingSlotsInHour(dayIdx, hour - 1) : [];
                      const isFirstHourOfSession = !prevHourSessions.some(s => s.title === slot.title);

                      // Calculate partial coloring for this cell
                      let partialColorTop = 0;
                      let partialColorHeight = 100;

                      if (slot.startHour !== undefined && slot.startMinute !== undefined &&
                          slot.endHour !== undefined && slot.endMinute !== undefined) {
                        const cellStartMinutes = hour * 60;
                        const cellEndMinutes = (hour + 1) * 60;
                        const sessionStartMinutes = slot.startHour * 60 + slot.startMinute;
                        const sessionEndMinutes = slot.endHour * 60 + slot.endMinute;

                        const colorStartMinutes = Math.max(cellStartMinutes, sessionStartMinutes);
                        const colorEndMinutes = Math.min(cellEndMinutes, sessionEndMinutes);

                        if (colorStartMinutes < colorEndMinutes) {
                          partialColorTop = ((colorStartMinutes - cellStartMinutes) / 60) * 100;
                          partialColorHeight = ((colorEndMinutes - colorStartMinutes) / 60) * 100;
                        }
                      }

                      // Calculate border radius
                      const nextHourSessions = hour < 23 ? getOverlappingSlotsInHour(dayIdx, hour + 1) : [];
                      const isLastHourOfSession = !nextHourSessions.some(s => s.title === slot.title);

                      let borderRadius = '0';
                      if (isFirstHourOfSession && isLastHourOfSession) {
                        borderRadius = '8px';
                      } else if (isFirstHourOfSession) {
                        borderRadius = '8px 8px 0 0';
                      } else if (isLastHourOfSession) {
                        borderRadius = '0 0 8px 8px';
                      }

                      return (
                        <div key={slot.title || sessionIndex} style={{ opacity: isBeingMoved ? 0.3 : 1 }}>
                          {/* Partial color overlay */}
                          <div
                            style={{
                              position: 'absolute',
                              top: `${partialColorTop}%`,
                              left: `${sessionLeft}%`,
                              width: `${sessionWidth}%`,
                              height: `${partialColorHeight}%`,
                              backgroundColor: getSlotColor(slot) + 'CC',
                              borderRadius: borderRadius,
                              zIndex: 1,
                              pointerEvents: 'none'
                            }}
                          />
                          {/* Session content */}
                          {isFirstHourOfSession && (
                            <div
                              className="text-xs"
                              style={{
                                position: 'absolute',
                                left: `${sessionLeft}%`,
                                width: `${sessionWidth}%`,
                                top: `${partialColorTop}%`,
                                height: `${partialColorHeight}%`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 2,
                                padding: '0.5rem'
                              }}
                            >
                              <div className="truncate font-semibold text-white text-center w-full">{slot.title}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Current time indicator line */}
                    {shouldShowTimeLine && timeLinePosition !== null && (
                      <div
                        style={{
                          position: 'absolute',
                          top: `${timeLinePosition}px`,
                          left: 0,
                          right: 0,
                          height: '2px',
                          backgroundColor: '#EF4444',
                          zIndex: 100,
                          pointerEvents: 'none'
                        }}
                      >
                        <div style={{
                          position: 'absolute',
                          left: 0,
                          top: '-4px',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: '#EF4444'
                        }} />
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
          </div>
        </div>
      </div>

      {/* Right side - Session Form Panel */}
      {editingSession && (
        <div className="w-96 bg-white flex-shrink-0 flex flex-col h-full" style={{ borderLeft: '1px solid #F3F4F6' }}>
          <div className="pt-8 pr-8 pb-8 pl-8 flex-1 overflow-y-auto">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              {slots.some(s => s.date === getLocalDateString(weekDates[editingSession.day]) && s.day === editingSession.day && s.title === sessionTitle) ? 'Edit Session' : 'New Session'}
            </h2>

            {/* Day info */}
            <div className="mb-8 text-sm text-gray-500">
              {days[editingSession.day]}, {weekDates[editingSession.day].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>

            {/* Title */}
            <div className="mb-10">
              <label className="block text-sm font-semibold text-gray-700 mb-4">
                Title
              </label>
              <input
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 bg-gray-50"
                placeholder="What did you work on?"
                autoFocus
              />
            </div>

            {/* Time Range */}
            <div className="mb-10">
              <label className="block text-sm font-semibold text-gray-700 mb-4">
                Time
              </label>
              <div className="flex gap-3 items-center text-sm">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={editingSession.startHour}
                  onChange={(e) => setEditingSession({ ...editingSession, startHour: parseInt(e.target.value) || 0 })}
                  className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-center bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className="text-gray-400">:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  step="15"
                  value={editingSession.startMinute}
                  onChange={(e) => setEditingSession({ ...editingSession, startMinute: parseInt(e.target.value) || 0 })}
                  className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-center bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={editingSession.endHour}
                  onChange={(e) => setEditingSession({ ...editingSession, endHour: parseInt(e.target.value) || 0 })}
                  className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-center bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className="text-gray-400">:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  step="15"
                  value={editingSession.endMinute}
                  onChange={(e) => setEditingSession({ ...editingSession, endMinute: parseInt(e.target.value) || 0 })}
                  className="w-14 px-2 py-1.5 border border-gray-200 rounded-lg text-center bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Labels */}
            <div className="mb-10">
              <label className="block text-sm font-semibold text-gray-700 mb-4">
                Labels
              </label>

              {/* Existing labels selection */}
              <div className="flex flex-wrap gap-2 mb-5">
                {allLabels.map((label) => {
                  const labelColor = getLabelColor(label);
                  const isSelected = sessionLabels.includes(label);
                  return (
                    <div key={label} className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (isSelected) {
                            handleRemoveLabel(label);
                          } else {
                            setSessionLabels([...sessionLabels, label]);
                          }
                        }}
                        className="px-3 py-1 text-xs rounded-full transition-colors font-medium"
                        style={{
                          backgroundColor: isSelected ? labelColor : labelColor + '20',
                          color: isSelected ? '#FFFFFF' : labelColor,
                          border: `2px solid ${labelColor}`
                        }}
                      >
                        {label}
                      </button>
                      <input
                        type="color"
                        value={labelColor}
                        onChange={(e) => handleUpdateLabelColor(label, e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer"
                        title="Change color"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Add new label */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddLabel()}
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 bg-gray-50"
                  placeholder="New label"
                />
                <button
                  onClick={handleAddLabel}
                  className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Files */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Linked Files
              </label>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={handleAddFiles}
                  className="flex-1 px-3 py-1.5 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Add Files
                </button>
                <button
                  onClick={handleAddFolder}
                  className="flex-1 px-3 py-1.5 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                  disabled={fileTrackingProgress?.isTracking}
                >
                  Add Folder
                </button>
              </div>

              {/* Loading indicator */}
              {fileTrackingProgress?.isTracking && (
                <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 text-sm text-blue-700">
                    <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full flex-shrink-0"></div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">
                        Loading<AnimatedDots />
                      </div>
                      {fileTrackingProgress.total > 0 && (
                        <div className="text-xs text-blue-600">
                          {fileTrackingProgress.current} / {fileTrackingProgress.total} files
                        </div>
                      )}
                      <div className="text-xs text-blue-500 truncate" title={fileTrackingProgress.fileName}>
                        {fileTrackingProgress.fileName}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {sessionFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {sessionFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg text-xs border border-gray-100 hover:bg-gray-100 transition-colors"
                    >
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => handleOpenFile(file.path)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate text-gray-800 hover:text-blue-600">{file.name}</div>
                          {file.backupName && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded" title={`Backed up: ${file.backupName}`}>
                              ✓ Backed up
                            </span>
                          )}
                          {file.tracked && !file.backupName && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded" title="Tracked in database (no backup copy)">
                              ✓ Tracked
                            </span>
                          )}
                        </div>
                        <div className="text-gray-500 truncate text-[10px]">{file.path}</div>
                        <div className="text-gray-400">{formatFileSize(file.size)}</div>
                        {file.hash && (
                          <div className="text-gray-400 text-[10px] font-mono" title={`Hash: ${file.hash}`}>
                            Hash: {file.hash.substring(0, 16)}...
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <button
                          onClick={() => handleOpenFile(file.path)}
                          className="px-2 py-1 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                          title="Open file/folder"
                        >
                          Open
                        </button>
                        {file.backupName && (
                          <button
                            onClick={() => handleOpenBackup(file.backupName!)}
                            className="px-2 py-1 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
                            title={`Open backup: ${file.backupName} (${file.isFullBackup ? 'Full' : 'Differential'})`}
                          >
                            📸 Backup
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveFile(file.id)}
                          className="text-gray-400 hover:text-red-500 text-lg"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="mb-8">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Notes
              </label>
              <textarea
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 bg-gray-50 resize-none"
                rows={4}
                placeholder="Additional notes..."
              />
            </div>

            {/* Actions */}
            <div className="flex justify-between items-center gap-3 pt-4 border-t border-gray-200">
              {/* Check if we're editing an existing session */}
              {slots.some(s => s.date === getLocalDateString(weekDates[editingSession.day]) && s.day === editingSession.day && s.title === sessionTitle) && (
                <button
                  onClick={handleDeleteSession}
                  className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              )}
              <div className="flex gap-3 ml-auto">
                <button
                  onClick={handleCancelSession}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveSession}
                  className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!sessionTitle.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase 4: Project linking dialog */}
      {showLinkDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Select Previous Project to Link</h3>
            <p className="text-sm text-gray-600 mb-4">
              Choose a previous project to link to. Only differences will be stored.
            </p>

            <div className="space-y-2 mb-6">
              {previousProjects.map(project => (
                <button
                  key={project.id}
                  onClick={() => handleSelectPreviousProject(project.id)}
                  className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
                >
                  <div className="font-medium text-gray-800">{project.name}</div>
                  <div className="text-xs text-gray-500 truncate">{project.path}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Created: {new Date(project.created_at).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLinkDialog(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
