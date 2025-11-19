import { useState } from 'react';
import { Session, FileLink } from '../types';
import { open } from '@tauri-apps/plugin-dialog';
import { stat } from '@tauri-apps/plugin-fs';

interface SessionModalProps {
  session: Session | null;
  initialDate?: Date;
  initialTime?: number;
  initialEndTime?: number;
  onClose: () => void;
  onSave: (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onDelete?: () => void;
}

export default function SessionModal({
  session,
  initialDate,
  initialTime,
  initialEndTime,
  onClose,
  onSave,
  onDelete,
}: SessionModalProps) {
  const [title, setTitle] = useState(session?.title || '');
  const [startTime, setStartTime] = useState(
    session?.startTime || (initialDate && initialTime !== undefined
      ? new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate(), initialTime, 0)
      : new Date())
  );
  const [endTime, setEndTime] = useState(
    session?.endTime || (initialDate && initialTime !== undefined
      ? new Date(
          initialDate.getFullYear(),
          initialDate.getMonth(),
          initialDate.getDate(),
          initialEndTime !== undefined ? initialEndTime : initialTime + 1,
          0
        )
      : new Date(Date.now() + 3600000))
  );
  const [labels, setLabels] = useState<string[]>(session?.labels || []);
  const [newLabel, setNewLabel] = useState('');
  const [files, setFiles] = useState<FileLink[]>(session?.files || []);
  const [notes, setNotes] = useState(session?.notes || '');

  const handleAddLabel = () => {
    if (newLabel.trim() && !labels.includes(newLabel.trim())) {
      setLabels([...labels, newLabel.trim()]);
      setNewLabel('');
    }
  };

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
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
              id: crypto.randomUUID(),
              name: path.split('/').pop() || path,
              path,
              size: metadata.size,
              type: 'file',
            });
          } catch (error) {
            console.error('Error reading file metadata:', error);
          }
        }

        setFiles([...files, ...newFiles]);
      }
    } catch (error) {
      console.error('Error selecting files:', error);
    }
  };

  const handleAddFolder = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (selected && typeof selected === 'string') {
        setFiles([
          ...files,
          {
            id: crypto.randomUUID(),
            name: selected.split('/').pop() || selected,
            path: selected,
            size: 0,
            type: 'folder',
          },
        ]);
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles(files.filter((f) => f.id !== fileId));
  };

  const handleSave = () => {
    if (!title.trim()) {
      alert('Please enter a title');
      return;
    }

    onSave({
      title: title.trim(),
      startTime,
      endTime,
      labels,
      files,
      notes,
    });
  };

  const formatDateTime = (date: Date) => {
    return date.toISOString().slice(0, 16);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return 'Folder';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="h-full flex flex-col p-6">
      <h2 className="text-2xl font-bold mb-4">
        {session ? 'Edit Session' : 'New Session'}
      </h2>

      <div className="flex-1 overflow-y-auto">
        {/* Title */}
        <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What did you work on?"
            />
          </div>

          {/* Time Range */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="datetime-local"
                value={formatDateTime(startTime)}
                onChange={(e) => setStartTime(new Date(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="datetime-local"
                value={formatDateTime(endTime)}
                onChange={(e) => setEndTime(new Date(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Labels */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Labels
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddLabel()}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add a label (e.g., YouTube, Frontend)"
              />
              <button
                onClick={handleAddLabel}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {labels.map((label) => (
                <span
                  key={label}
                  className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm flex items-center gap-2"
                >
                  {label}
                  <button
                    onClick={() => handleRemoveLabel(label)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Files */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Linked Files
            </label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={handleAddFiles}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
              >
                Add Files
              </button>
              <button
                onClick={handleAddFolder}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
              >
                Add Folder
              </button>
            </div>
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{file.name}</div>
                    <div className="text-xs text-gray-500 truncate">{file.path}</div>
                    <div className="text-xs text-gray-400">{formatFileSize(file.size)}</div>
                  </div>
                  <button
                    onClick={() => handleRemoveFile(file.id)}
                    className="ml-2 text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Additional notes..."
            />
          </div>

      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-4 border-t mt-4 flex-shrink-0">
        <div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
