import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { stat } from '@tauri-apps/plugin-fs';

interface TimeSlot {
  day: number; // 0-6 for Sun-Sat
  hour: number; // 0-23
  title?: string;
  labels?: string[];
  files?: FileLink[];
  notes?: string;
}

interface SessionEdit {
  day: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

interface FileLink {
  name: string;
  path: string;
  size: number;
}

export default function SimpleCalendar() {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [dragStart, setDragStart] = useState<{ day: number; hour: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ day: number; hour: number } | null>(null);
  const [editingSession, setEditingSession] = useState<SessionEdit | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionLabels, setSessionLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [allLabels, setAllLabels] = useState<string[]>(['Work', 'Personal', 'Meeting', 'Project']); // Sample labels
  const [sessionFiles, setSessionFiles] = useState<FileLink[]>([]);
  const [sessionNotes, setSessionNotes] = useState('');

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Get current date info
  const today = new Date();
  const currentMonth = today.toLocaleDateString('en-US', { month: 'long' });
  const currentYear = today.getFullYear();

  // Calculate dates for the week starting from Sunday
  const getWeekDates = () => {
    const curr = new Date();
    const first = curr.getDate() - curr.getDay(); // First day is Sunday
    return days.map((_, i) => {
      const date = new Date(curr.setDate(first + i));
      return new Date(date);
    });
  };

  const weekDates = getWeekDates();

  const handleMouseDown = (day: number, hour: number) => {
    console.log('Mouse down:', day, hour);
    setDragStart({ day, hour });
    setDragEnd({ day, hour });
  };

  const handleMouseEnter = (day: number, hour: number) => {
    if (dragStart && dragStart.day === day) {
      console.log('Mouse enter:', day, hour);
      setDragEnd({ day, hour });
    }
  };

  const handleMouseUp = (day: number, hour: number) => {
    console.log('Mouse up:', day, hour);
    if (dragStart) {
      const minHour = Math.min(dragStart.hour, hour);
      const maxHour = Math.max(dragStart.hour, hour);

      // Open the edit panel
      setEditingSession({
        day: dragStart.day,
        startHour: minHour,
        startMinute: 0,
        endHour: maxHour + 1,
        endMinute: 0,
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
      const newSlots: TimeSlot[] = [];
      for (let h = editingSession.startHour; h < editingSession.endHour; h++) {
        newSlots.push({
          day: editingSession.day,
          hour: h,
          title: sessionTitle.trim(),
          labels: sessionLabels.length > 0 ? sessionLabels : undefined,
          files: sessionFiles.length > 0 ? sessionFiles : undefined,
          notes: sessionNotes.trim() || undefined,
        });
      }
      setSlots([...slots, ...newSlots]);
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
      }
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (label: string) => {
    setSessionLabels(sessionLabels.filter(l => l !== label));
  };

  const handleAddFiles = async () => {
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
            const metadata = await stat(path);
            newFiles.push({
              name: path.split('/').pop() || path,
              path,
              size: metadata.size,
            });
          } catch (error) {
            console.error('Error reading file metadata:', error);
          }
        }

        setSessionFiles([...sessionFiles, ...newFiles]);
      }
    } catch (error) {
      console.error('Error selecting files:', error);
    }
  };

  const handleRemoveFile = (path: string) => {
    setSessionFiles(sessionFiles.filter(f => f.path !== path));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const isDragging = (day: number, hour: number) => {
    if (!dragStart || !dragEnd || dragStart.day !== day) return false;
    const min = Math.min(dragStart.hour, dragEnd.hour);
    const max = Math.max(dragStart.hour, dragEnd.hour);
    return hour >= min && hour <= max;
  };

  const getSlotAtPosition = (day: number, hour: number) => {
    return slots.find(s => s.day === day && s.hour === hour);
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
              <button className="text-sm text-gray-600 hover:text-gray-900">‹</button>
              <button className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50">Today</button>
              <button className="text-sm text-gray-600 hover:text-gray-900">›</button>
              <button
                onClick={() => setSlots([])}
                className="ml-4 px-3 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <div>
            {/* Day Headers */}
            <div style={{ display: 'flex', backgroundColor: 'white', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ width: '128px', flexShrink: 0 }}></div>
              {days.map((day, i) => {
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
                      {day.slice(0, 3)}
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
              {days.map((day, dayIdx) => {
                const slot = getSlotAtPosition(dayIdx, hour);
                const isDrag = isDragging(dayIdx, hour);

                return (
                  <div
                    key={dayIdx}
                    className="cursor-pointer select-none"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleMouseDown(dayIdx, hour);
                    }}
                    onMouseEnter={(e) => {
                      e.preventDefault();
                      handleMouseEnter(dayIdx, hour);
                    }}
                    onMouseUp={(e) => {
                      e.preventDefault();
                      handleMouseUp(dayIdx, hour);
                    }}
                    style={{
                      flex: 1,
                      minWidth: '120px',
                      height: '60px',
                      padding: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isDrag ? '#DBEAFE' : slot ? '#DCFCE7' : '#FFFFFF',
                      borderRight: '1px solid #F3F4F6',
                      boxSizing: 'border-box',
                      transition: 'background-color 0.1s'
                    }}
                  >
                    {slot && (
                      <div className="text-xs w-full">
                        <div className="truncate font-medium text-gray-800 text-center">{slot.title}</div>
                        {slot.labels && slot.labels.length > 0 && (
                          <div className="flex gap-1 flex-wrap mt-1 justify-center">
                            {slot.labels.map((label, idx) => (
                              <span key={idx} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                        {slot.files && slot.files.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-1 text-center">
                            {slot.files.length} file{slot.files.length > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    )}
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
          <div className="p-6 flex-1 overflow-y-auto">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">New Session</h2>

            {/* Day info */}
            <div className="mb-4 text-sm text-gray-600">
              <strong>{days[editingSession.day]}</strong>
            </div>

            {/* Title */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">
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
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Time
              </label>
              <div className="flex gap-2 items-center text-sm">
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
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Labels
              </label>

              {/* Existing labels selection */}
              <div className="flex flex-wrap gap-2 mb-3">
                {allLabels.map((label) => (
                  <button
                    key={label}
                    onClick={() => {
                      if (sessionLabels.includes(label)) {
                        handleRemoveLabel(label);
                      } else {
                        setSessionLabels([...sessionLabels, label]);
                      }
                    }}
                    className={`px-3 py-1 text-xs rounded-full transition-colors ${
                      sessionLabels.includes(label)
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
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
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Linked Files
              </label>
              <button
                onClick={handleAddFiles}
                className="w-full px-3 py-2.5 text-sm border-2 border-dashed border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 text-gray-600 transition-colors"
              >
                + Add Files
              </button>

              {sessionFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {sessionFiles.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg text-xs border border-gray-100"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-gray-800">{file.name}</div>
                        <div className="text-gray-500">{formatFileSize(file.size)}</div>
                      </div>
                      <button
                        onClick={() => handleRemoveFile(file.path)}
                        className="ml-2 text-gray-400 hover:text-red-500 text-lg"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">
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
            <div className="flex justify-end gap-3">
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
      )}
    </div>
  );
}
