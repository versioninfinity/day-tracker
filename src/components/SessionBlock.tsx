import { Session } from '../types';

interface SessionBlockProps {
  session: Session;
  onClick: (e: React.MouseEvent) => void;
}

export default function SessionBlock({ session, onClick }: SessionBlockProps) {
  const duration = (session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60); // in minutes
  const height = Math.max((duration / 60) * 4, 2); // 4rem per hour, minimum 2rem

  const labelColors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-yellow-500',
    'bg-red-500',
  ];

  const getLabelColor = (label: string) => {
    const hash = label.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return labelColors[hash % labelColors.length];
  };

  return (
    <div
      className="absolute inset-x-1 bg-blue-100 border-l-4 border-blue-500 rounded p-2 cursor-pointer hover:shadow-md transition-shadow overflow-hidden z-10"
      style={{ height: `${height}rem` }}
      onClick={onClick}
    >
      <div className="text-sm font-semibold text-gray-900 truncate">{session.title}</div>
      <div className="text-xs text-gray-600">
        {session.startTime.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        })} - {session.endTime.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        })}
      </div>
      {session.labels.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {session.labels.map((label, idx) => (
            <span
              key={idx}
              className={`text-xs px-1.5 py-0.5 rounded text-white ${getLabelColor(label)}`}
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {session.files.length > 0 && (
        <div className="text-xs text-gray-500 mt-1">
          {session.files.length} file{session.files.length > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
