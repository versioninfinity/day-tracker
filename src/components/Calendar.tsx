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

  const handleMouseDown = (date: Date, hour: number) => {
    setDragState({
      isDragging: true,
      startDate: date,
      startHour: hour,
      endHour: hour + 1,
    });
  };

  const handleMouseEnter = (date: Date, hour: number) => {
    if (dragState.isDragging && dragState.startDate?.toDateString() === date.toDateString()) {
      const newEndHour = hour + 1;
      setDragState((prev) => ({
        ...prev,
        endHour: newEndHour,
      }));
    }
  };

  const handleMouseUp = (date: Date, hour: number) => {
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

  const handleSessionClick = (session: Session) => {
    setEditingSession(session);
    setIsModalOpen(true);
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
            {weekData.map((day, dayIndex) => (
              <div
                key={day.date.toISOString()}
                className={`flex-1 bg-white ${dayIndex < weekData.length - 1 ? 'border-r border-gray-200' : ''}`}
              >
                {/* Day header - empty for now, day name is in top header */}
                <div className="h-12 border-b border-gray-200"></div>

                {/* Hour slots */}
                {hours.map((hour) => {
                  const sessionsAtHour = day.sessions.filter((session) => {
                    const sessionHour = session.startTime.getHours();
                    return sessionHour === hour;
                  });

                  const isInDragPreview = isDragPreviewInSlot(day.date, hour);

                  return (
                    <div
                      key={hour}
                      className={`h-16 border-b border-gray-200 cursor-pointer transition-colors relative select-none ${
                        isInDragPreview ? 'bg-blue-200' : 'hover:bg-blue-50'
                      }`}
                      onMouseDown={() => handleMouseDown(day.date, hour)}
                      onMouseEnter={() => handleMouseEnter(day.date, hour)}
                      onMouseUp={() => handleMouseUp(day.date, hour)}
                    >
                      {sessionsAtHour.map((session) => (
                        <SessionBlock
                          key={session.id}
                          session={session}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSessionClick(session);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
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
