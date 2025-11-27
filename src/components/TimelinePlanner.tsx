/**
 * Timeline Planner Component
 * Horizontal timeline with train-style markers and AI chat interface
 */

import { useState, useEffect, useRef } from 'react';
import { storageService, TimelineProject, TimelineMilestone, TimelineChatMessage } from '../services/storage';
import { sendChatMessage, ChatMessage, hasApiKey, setApiKey } from '../services/groqService';

interface TimelinePlannerProps {
  isExpanded: boolean;
  onToggle: () => void;
}

export default function TimelinePlanner({ isExpanded, onToggle }: TimelinePlannerProps) {
  const [projects, setProjects] = useState<TimelineProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<TimelineProject | null>(null);
  const [milestones, setMilestones] = useState<TimelineMilestone[]>([]);
  const [chatHistory, setChatHistory] = useState<TimelineChatMessage[]>([]);
  const [chatSummaries, setChatSummaries] = useState<string[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedMilestone, setSelectedMilestone] = useState<TimelineMilestone | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(!hasApiKey());
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  // Load project data when selected
  useEffect(() => {
    if (selectedProject) {
      loadProjectData(selectedProject.id);
    }
  }, [selectedProject]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const loadProjects = async () => {
    if (!storageService.isInitialized()) return;
    const loaded = await storageService.getTimelineProjects();
    setProjects(loaded);
  };

  const loadProjectData = async (projectId: string) => {
    if (!storageService.isInitialized()) return;

    const [loadedMilestones, loadedHistory, loadedSummaries] = await Promise.all([
      storageService.getTimelineMilestones(projectId),
      storageService.getTimelineChatHistory(projectId, 50),
      storageService.getTimelineChatSummaries(projectId)
    ]);

    setMilestones(loadedMilestones);
    setChatHistory(loadedHistory);
    setChatSummaries(loadedSummaries.map(s => s.summary));
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !storageService.isInitialized()) return;

    const project = await storageService.createTimelineProject(newProjectName.trim());
    setProjects([project, ...projects]);
    setSelectedProject(project);
    setNewProjectName('');
    setShowNewProjectInput(false);
  };

  const handleSelectProject = (project: TimelineProject) => {
    setSelectedProject(project);
    setSelectedMilestone(null);
    setMilestones([]);
    setChatHistory([]);
    setChatSummaries([]);
  };

  const handleColorChange = async (projectId: string, color: string) => {
    if (!storageService.isInitialized()) return;

    await storageService.updateTimelineProject(projectId, { color });
    if (selectedProject?.id === projectId) {
      setSelectedProject({ ...selectedProject, color });
    }
    setProjects(projects.map(p =>
      p.id === projectId ? { ...p, color } : p
    ));
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!storageService.isInitialized()) return;

    await storageService.deleteTimelineProject(projectId);
    setProjects(projects.filter(p => p.id !== projectId));
    if (selectedProject?.id === projectId) {
      setSelectedProject(null);
      setMilestones([]);
      setChatHistory([]);
      setChatSummaries([]);
    }
  };

  const handleMilestoneClick = (milestone: TimelineMilestone) => {
    setSelectedMilestone(selectedMilestone?.id === milestone.id ? null : milestone);
  };

  const handleStatusChange = async (milestone: TimelineMilestone, newStatus: TimelineMilestone['status']) => {
    if (!storageService.isInitialized()) return;

    await storageService.updateTimelineMilestone(milestone.id, { status: newStatus });
    setMilestones(milestones.map(m =>
      m.id === milestone.id ? { ...m, status: newStatus } : m
    ));
    setSelectedMilestone({ ...milestone, status: newStatus });
  };

  const handleDeleteMilestone = async (milestoneId: string) => {
    if (!storageService.isInitialized()) return;

    await storageService.deleteTimelineMilestone(milestoneId);
    setMilestones(milestones.filter(m => m.id !== milestoneId));
    setSelectedMilestone(null);
  };

  const handleSaveApiKey = () => {
    if (!apiKeyInput.trim()) return;
    setApiKey(apiKeyInput.trim());
    setShowApiKeyInput(false);
    setApiKeyInput('');
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedProject || isLoading || !hasApiKey()) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsLoading(true);

    // Add user message to history
    const userChatMessage = await storageService.addTimelineChatMessage(
      selectedProject.id,
      'user',
      userMessage
    );
    setChatHistory(prev => [...prev, userChatMessage]);

    try {
      // Convert chat history to format expected by Groq
      const formattedHistory: ChatMessage[] = chatHistory.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      }));

      const result = await sendChatMessage(
        selectedProject.id,
        selectedProject.name,
        userMessage,
        formattedHistory,
        milestones,
        chatSummaries
      );

      // Save assistant response
      const assistantMessage = await storageService.addTimelineChatMessage(
        selectedProject.id,
        'assistant',
        result.response,
        result.toolCalls.length > 0 ? { toolCalls: result.toolCalls, toolResults: result.toolResults } : undefined
      );
      setChatHistory(prev => [...prev, assistantMessage]);

      // Update milestones
      setMilestones(result.updatedMilestones);

    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = await storageService.addTimelineChatMessage(
        selectedProject.id,
        'assistant',
        'Sorry, I encountered an error. Please try again.'
      );
      setChatHistory(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return '#10B981';
      case 'in_progress': return '#3B82F6';
      case 'blocked': return '#EF4444';
      default: return '#9CA3AF';
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!isExpanded) {
    // Collapsed state - just show the toggle bar
    return (
      <div
        onClick={onToggle}
        className="h-10 bg-white border-b border-gray-100 flex items-center px-4 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <span style={{ transform: 'rotate(-90deg)', display: 'inline-block' }}>›</span>
          <span>Projects</span>
          {projects.length > 0 && (
            <span className="text-xs text-gray-400">({projects.length})</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-gray-200">
      {/* Header with project tabs */}
      <div className="h-12 border-b border-gray-100 flex items-center px-4 gap-2">
        <div
          onClick={onToggle}
          className="cursor-pointer text-gray-400 hover:text-gray-600 mr-2"
        >
          <span style={{ transform: 'rotate(90deg)', display: 'inline-block' }}>›</span>
        </div>

        {/* Project tabs */}
        <div className="flex items-center gap-2 flex-1 overflow-x-auto">
          {projects.map(project => (
            <div key={project.id} className="flex items-center gap-1 group">
              <button
                onClick={() => handleSelectProject(project)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap ${
                  selectedProject?.id === project.id
                    ? 'text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                style={selectedProject?.id === project.id ? { backgroundColor: project.color } : undefined}
              >
                {project.name}
              </button>
              <input
                type="color"
                value={project.color}
                onChange={(e) => handleColorChange(project.id, e.target.value)}
                className="w-6 h-6 rounded cursor-pointer"
                title="Change color"
              />
              <button
                onClick={() => handleDeleteProject(project.id)}
                className="w-5 h-5 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-sm"
                title="Delete project"
              >
                ×
              </button>
            </div>
          ))}

          {showNewProjectInput ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                placeholder="Project name"
                className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:border-gray-400"
                autoFocus
              />
              <button
                onClick={handleCreateProject}
                className="px-2 py-1 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
              >
                Add
              </button>
              <button
                onClick={() => { setShowNewProjectInput(false); setNewProjectName(''); }}
                className="px-2 py-1 text-sm text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewProjectInput(true)}
              className="px-2 py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md"
            >
              + New
            </button>
          )}
        </div>
      </div>

      {selectedProject ? (
        <div className="flex" style={{ height: '280px', minHeight: '200px', maxHeight: '400px' }}>
          {/* Timeline visualization - horizontal train style with scroll */}
          <div className="flex-1 flex flex-col border-r border-gray-100 min-w-0 min-h-0">
            {/* Scrollable timeline area */}
            <div className="flex-1 overflow-x-auto overflow-y-auto p-4 min-h-0">
              <div style={{ minWidth: milestones.length > 0 ? `${milestones.length * 180 + 100}px` : '100%' }}>
                {milestones.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                    No milestones yet. Let's plan together!
                  </div>
                ) : (
                  <div className="relative h-full flex items-center">
                    {/* Horizontal line - full width, uses project color */}
                    <div
                      className="absolute left-0 right-0 h-0.5"
                      style={{ top: '50%', transform: 'translateY(-50%)', backgroundColor: selectedProject?.color || '#E5E7EB' }}
                    />

                    {/* Left end cap */}
                    <div
                      className="absolute w-3 h-3 border-2 rounded-full bg-white"
                      style={{ left: '8px', top: '50%', transform: 'translateY(-50%)', borderColor: selectedProject?.color || '#D1D5DB' }}
                    />

                    {/* Right end cap */}
                    <div
                      className="absolute w-3 h-3 border-2 rounded-full bg-white"
                      style={{ right: '8px', top: '50%', transform: 'translateY(-50%)', borderColor: selectedProject?.color || '#D1D5DB' }}
                    />

                    {/* Milestones - generous spacing */}
                    <div className="flex items-center pl-12 pr-12" style={{ gap: '140px' }}>
                      {milestones.map((milestone) => (
                        <div
                          key={milestone.id}
                          className="relative flex flex-col items-center cursor-pointer group"
                          onClick={() => handleMilestoneClick(milestone)}
                        >
                          {/* Milestone marker - larger and interactive */}
                          <div
                            className={`w-5 h-5 rounded-full border-2 bg-white z-10 transition-all duration-200 ${
                              selectedMilestone?.id === milestone.id
                                ? 'scale-150 shadow-lg'
                                : 'group-hover:scale-125'
                            }`}
                            style={{
                              borderColor: getStatusColor(milestone.status),
                              backgroundColor: milestone.status === 'completed' ? getStatusColor(milestone.status) : 'white'
                            }}
                          />

                          {/* Title, status, date, and delete below - stacked vertically */}
                          <div className="absolute top-8 flex flex-col items-center" style={{ width: '120px' }}>
                            <div className="text-xs text-gray-700 font-medium text-center" style={{ lineHeight: '1.3' }}>
                              {milestone.title}
                            </div>
                            <div
                              className="mt-1 text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap font-medium"
                              style={{
                                backgroundColor: getStatusColor(milestone.status) + '15',
                                color: getStatusColor(milestone.status)
                              }}
                            >
                              {milestone.status.replace('_', ' ')}
                            </div>
                            <div className="mt-1 text-[10px] text-gray-400">
                              {formatDate(milestone.date)}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteMilestone(milestone.id);
                              }}
                              className="mt-1 w-4 h-4 rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                              title="Delete milestone"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Selected milestone details panel */}
            {selectedMilestone && (
              <div className="border-t border-gray-100 p-3 bg-gray-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 text-sm">{selectedMilestone.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{formatDate(selectedMilestone.date)}</div>
                    {selectedMilestone.description && (
                      <div className="text-xs text-gray-600 mt-2">{selectedMilestone.description}</div>
                    )}
                    {selectedMilestone.agent_task && (
                      <div className="text-xs text-blue-600 mt-1">Task: {selectedMilestone.agent_task}</div>
                    )}
                    {selectedMilestone.agent_todo && (
                      <div className="text-xs text-amber-600 mt-1">Todo: {selectedMilestone.agent_todo}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Status selector */}
                    <select
                      value={selectedMilestone.status}
                      onChange={(e) => handleStatusChange(selectedMilestone, e.target.value as TimelineMilestone['status'])}
                      className="text-xs px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none"
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="blocked">Blocked</option>
                    </select>
                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteMilestone(selectedMilestone.id)}
                      className="text-xs px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    >
                      Delete
                    </button>
                    {/* Close button */}
                    <button
                      onClick={() => setSelectedMilestone(null)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Chat interface */}
          <div className="w-96 flex flex-col bg-gray-50 min-w-0 shrink-0">
            {/* API Key setup banner */}
            {showApiKeyInput && (
              <div className="p-3 bg-amber-50 border-b border-amber-200">
                <div className="text-xs text-amber-800 mb-2">
                  Enter your Groq API key to enable AI chat.
                  <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="ml-1 underline">Get one free</a>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                    placeholder="gsk_..."
                    className="flex-1 px-2 py-1 text-xs border border-amber-300 rounded focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={handleSaveApiKey}
                    className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              {chatHistory.length === 0 && !showApiKeyInput && (
                <div className="text-center text-gray-400 text-sm py-4">
                  <div className="mb-2">Let's plan your project together!</div>
                  <div className="text-xs text-gray-300">
                    Try: "What milestones should we have for a product launch?"
                  </div>
                </div>
              )}
              {chatHistory.map((msg) => (
                <div
                  key={msg.id}
                  className={`text-sm p-3 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-gray-900 text-white ml-8'
                      : 'bg-white text-gray-700 mr-4 border border-gray-100 shadow-sm'
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              {isLoading && (
                <div className="bg-white text-gray-500 text-sm p-3 rounded-lg mr-4 border border-gray-100 shadow-sm">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                  </span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-gray-200 bg-white">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  placeholder={showApiKeyInput ? "Add API key first..." : "What should we plan next?"}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400"
                  disabled={isLoading || showApiKeyInput}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isLoading || !inputMessage.trim() || showApiKeyInput}
                  className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
              {!showApiKeyInput && hasApiKey() && (
                <button
                  onClick={() => setShowApiKeyInput(true)}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-600"
                >
                  Change API key
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="h-24 flex items-center justify-center text-gray-400 text-sm">
          Select or create a project to start planning together
        </div>
      )}
    </div>
  );
}
