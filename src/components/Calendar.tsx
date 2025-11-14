import { useState, useRef } from 'react';
import { Session, DayData } from '../types';
import SessionBlock from './SessionBlock';
import SessionModal from './SessionModal';

interface CalendarProps {
  weekData: DayData[];
  onSessionCreate: (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onSessionUpdate: (session: Session) => void;
  onSessionDelete: (sessionId: string) => void;
}

interface DragState {
  isDragging: boolean;
  startDate: Date | null;
  startHour: number | null;
  endHour: number | null;
}

export default function Calendar({ weekData, onSessionCreate, onSessionUpdate, onSessionDelete }: CalendarProps) {
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; time: number; endTime?: number } | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startDate: null,
    startHour: null,
    endHour: null,
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const today = new Date();

  // Click handler for session blocks
  const handleSessionClick = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    console.log('Session clicked:', session.title);
    setEditingSession(session);
    setIsModalOpen(true);
  };

  // Click handler for empty blocks - start drag to create
  const handleEmptyBlockMouseDown = (date: Date, hour: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    console.log('Empty block mouse down:', date, hour);
    setDragState({
      isDragging: true,
      startDate: date,
      startHour: hour,
      endHour: hour + 1,
    });
  };

  const handleEmptyBlockMouseEnter = (date: Date, hour: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragState.isDragging && dragState.startDate?.toDateString() === date.toDateString()) {
      console.log('Empty block mouse enter:', date, hour);
      const newEndHour = hour + 1;
      setDragState((prev) => ({
        ...prev,
        endHour: newEndHour,
      }));
    }
  };

  const handleEmptyBlockMouseUp = (date: Date, hour: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    console.log('Empty block mouse up:', date, hour);
    if (dragState.isDragging && dragState.startHour !== null && dragState.startDate) {
      const startHour = Math.min(dragState.startHour, hour);
      const endHour = Math.max(dragState.startHour + 1, hour + 1);

      setSelectedSlot({
        date: dragState.startDate,
        time: startHour,
        endTime: endHour
      });
      setIsModalOpen(true);

      setDragState({
        isDragging: false,
        startDate: null,
        startHour: null,
        endHour: null,
      });
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedSlot(null);
    setEditingSession(null);
  };

  const handleSessionSave = (sessionData: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingSession) {
      onSessionUpdate({ ...editingSession, ...sessionData });
    } else {
      onSessionCreate(sessionData);
    }
    handleModalClose();
  };

  const isDragPreviewInSlot = (date: Date, hour: number): boolean => {
    if (!dragState.isDragging || !dragState.startDate || dragState.startHour === null || dragState.endHour === null) {
      return false;
    }

    if (date.toDateString() !== dragState.startDate.toDateString()) {
      return false;
    }

    const minHour = Math.min(dragState.startHour, dragState.endHour - 1);
    const maxHour = Math.max(dragState.startHour, dragState.endHour - 1);

    return hour >= minHour && hour < maxHour;
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left side - Calendar */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
          <div className="flex justify-between items-center mb-2">
            <h1 className="text-2xl font-bold text-gray-900">Day Tracker</h1>
            <button
              onClick={() => {
                if (confirm('Clear all sessions? This cannot be undone.')) {
                  localStorage.removeItem('sessions');
                  window.location.reload();
                }
              }}
              className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded"
            >
              Clear All
            </button>
          </div>
          <div className="flex gap-2">
            {weekData.map((day) => {
              const isToday = day.date.toDateString() === today.toDateString();
              return (
                <div
                  key={day.date.toISOString()}
                  className={`flex-1 text-center p-2 rounded ${
                    isToday ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-100'
                  }`}
                >
                  <div className="text-xs text-gray-600">
                    {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className="font-semibold">
                    {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 overflow-auto">
          <div className="flex border-l border-gray-200">
            {/* Time labels column */}
            <div className="w-20 flex-shrink-0 bg-white border-r border-gray-200 sticky left-0 z-10">
              {/* Empty header space */}
              <div className="h-12 border-b border-gray-200"></div>
              {/* Time labels */}
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="h-16 border-b border-gray-200 px-2 py-1 text-xs text-gray-600 flex items-start"
                >
                  {hour.toString().padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekData.map((day, dayIndex) => {
              // Helper to find which session (if any) occupies a specific block
              const getSessionAtBlock = (hour: number, halfHour: 0 | 1, column: 0 | 1 | 2 | 3) => {
                const blockStartMinutes = hour * 60 + halfHour * 30;
                const blockEndMinutes = blockStartMinutes + 30;

                // Find the first session that matches this exact block
                return day.sessions.find(session => {
                  const sessionStartMinutes = session.startTime.getHours() * 60 + session.startTime.getMinutes();
                  const sessionEndMinutes = session.endTime.getHours() * 60 + session.endTime.getMinutes();

                  // Session must overlap this block
                  const overlaps = sessionStartMinutes < blockEndMinutes && sessionEndMinutes > blockStartMinutes;

                  // For now, all sessions go in column 0 (leftmost)
                  return overlaps && column === 0;
                }) || null;
              };

              return (
                <div
                  key={day.date.toISOString()}
                  className={`flex-1 bg-white ${dayIndex < weekData.length - 1 ? 'border-r border-gray-200' : ''} relative`}
                >
                  {/* Day header */}
                  <div className="h-12 border-b border-gray-200"></div>

                  {/* Hour slots - each hour is 8 divs (2 rows x 4 columns) */}
                  {hours.map((hour) => {
                    const isInDragPreview = isDragPreviewInSlot(day.date, hour);

                    return (
                      <div
                        key={hour}
                        className="h-16 border-b-2 border-gray-400 relative"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(4, 1fr)',
                          gridTemplateRows: 'repeat(2, 1fr)',
                          gap: '2px',
                          backgroundColor: '#9CA3AF',
                          padding: '1px',
                          gridAutoFlow: 'column'
                        }}
                      >
                        {/* 8 divs: 4 columns x 2 half-hours */}
                        {([0, 1, 2, 3] as const).map((column) =>
                          ([0, 1] as const).map((halfHour) => {
                            const session = getSessionAtBlock(hour, halfHour, column);
                            const blockKey = `${hour}-${halfHour}-${column}`;

                            if (session) {
                              // This block belongs to a session
                              return (
                                <div
                                  key={blockKey}
                                  className="bg-blue-100 cursor-pointer hover:shadow-md transition-shadow flex items-center justify-center text-xs overflow-hidden"
                                  onClick={(e) => handleSessionClick(session, e)}
                                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                  onMouseEnter={(e) => { e.stopPropagation(); }}
                                  onMouseUp={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                  title={session.title}
                                >
                                  {/* Only show title in first block of session */}
                                  {halfHour === 0 && (
                                    <span className="truncate px-1 font-semibold text-gray-900 text-[10px]">
                                      {session.title}
                                    </span>
                                  )}
                                </div>
                              );
                            } else {
                              // Empty block with visible grid
                              return (
                                <div
                                  key={blockKey}
                                  className={`bg-white cursor-pointer transition-colors select-none ${
                                    isInDragPreview ? 'bg-blue-200' : 'hover:bg-blue-50'
                                  }`}
                                  onMouseDown={(e) => handleEmptyBlockMouseDown(day.date, hour, e)}
                                  onMouseEnter={(e) => handleEmptyBlockMouseEnter(day.date, hour, e)}
                                  onMouseUp={(e) => handleEmptyBlockMouseUp(day.date, hour, e)}
                                />
                              );
                            }
                          })
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
      {isModalOpen && (
        <div className="w-96 bg-white border-l border-gray-200 flex-shrink-0 overflow-y-auto">
          <SessionModal
            session={editingSession}
            initialDate={selectedSlot?.date}
            initialTime={selectedSlot?.time}
            initialEndTime={selectedSlot?.endTime}
            onClose={handleModalClose}
            onSave={handleSessionSave}
            onDelete={editingSession ? () => {
              onSessionDelete(editingSession.id);
              handleModalClose();
            } : undefined}
          />
        </div>
      )}
    </div>
  );
}
