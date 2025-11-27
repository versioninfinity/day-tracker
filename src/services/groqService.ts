/**
 * Groq API Service for Timeline Planning Chat
 * Uses Llama 4 for conversational timeline planning with tool use
 */

import { storageService, TimelineMilestone } from './storage';

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY_STORAGE_KEY = 'groq_api_key';

// Get API key from localStorage
function getApiKey(): string {
  return localStorage.getItem(GROQ_API_KEY_STORAGE_KEY) || '';
}

// Set API key in localStorage
export function setApiKey(key: string): void {
  localStorage.setItem(GROQ_API_KEY_STORAGE_KEY, key);
}

// Check if API key is configured
export function hasApiKey(): boolean {
  return !!getApiKey();
}

// Fallback models in order of preference
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768'
];

// Tool definitions for timeline manipulation
const TIMELINE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_milestone',
      description: 'Add a new milestone to the project timeline',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the milestone'
          },
          date: {
            type: 'string',
            description: 'Target date for the milestone (YYYY-MM-DD format)'
          },
          description: {
            type: 'string',
            description: 'Detailed description of what this milestone entails'
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'blocked'],
            description: 'Current status of the milestone'
          }
        },
        required: ['title', 'date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_milestone',
      description: 'Update an existing milestone',
      parameters: {
        type: 'object',
        properties: {
          milestone_id: {
            type: 'string',
            description: 'ID of the milestone to update'
          },
          title: {
            type: 'string',
            description: 'New title for the milestone'
          },
          date: {
            type: 'string',
            description: 'New target date (YYYY-MM-DD format)'
          },
          description: {
            type: 'string',
            description: 'New description'
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'blocked'],
            description: 'New status'
          },
          agent_task: {
            type: 'string',
            description: 'Task for the AI agent to work on'
          },
          agent_delivery: {
            type: 'string',
            description: 'What the AI agent has delivered'
          },
          agent_todo: {
            type: 'string',
            description: 'Pending items for the AI agent'
          }
        },
        required: ['milestone_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_milestone',
      description: 'Delete a milestone from the timeline',
      parameters: {
        type: 'object',
        properties: {
          milestone_id: {
            type: 'string',
            description: 'ID of the milestone to delete'
          }
        },
        required: ['milestone_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_timeline',
      description: 'Get the current timeline with all milestones',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  }
];

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  result: any;
  success: boolean;
}

/**
 * Execute a tool call and return the result
 */
async function executeTool(
  projectId: string,
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; result: any }> {
  try {
    switch (toolName) {
      case 'add_milestone': {
        const milestone = await storageService.createTimelineMilestone(
          projectId,
          args.title,
          args.date,
          {
            description: args.description,
            status: args.status || 'pending'
          }
        );
        return { success: true, result: milestone };
      }

      case 'update_milestone': {
        const { milestone_id, ...updates } = args;
        await storageService.updateTimelineMilestone(milestone_id, updates);
        return { success: true, result: { updated: true, milestone_id } };
      }

      case 'delete_milestone': {
        await storageService.deleteTimelineMilestone(args.milestone_id);
        return { success: true, result: { deleted: true, milestone_id: args.milestone_id } };
      }

      case 'get_timeline': {
        const milestones = await storageService.getTimelineMilestones(projectId);
        return { success: true, result: milestones };
      }

      default:
        return { success: false, result: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`Tool execution error (${toolName}):`, error);
    return { success: false, result: String(error) };
  }
}

/**
 * Build system prompt with current timeline context
 */
function buildSystemPrompt(
  projectName: string,
  milestones: TimelineMilestone[],
  summaries: string[]
): string {
  const today = new Date().toISOString().split('T')[0];

  let prompt = `You are a collaborative project planning partner. You think alongside the user to help them plan "${projectName}".

Today: ${today}

Your role:
- Think WITH the user, not just FOR them
- Ask clarifying questions when things are ambiguous
- Suggest ideas but also ask "what do you think?" or "does this timing work for you?"
- When the user shares a goal, help break it down together
- Be conversational and natural - this is a back-and-forth planning session
- Offer alternatives: "We could do X, or alternatively Y - which feels right?"

You can modify the timeline using these tools:
- add_milestone: Create milestones (title, date, description, status)
- update_milestone: Change existing milestones
- delete_milestone: Remove milestones
- get_timeline: See current state

Guidelines:
- Don't add milestones unless the user confirms or clearly wants them
- When suggesting milestones, describe them first and ask if they should be added
- If the user gives a vague request like "plan a launch", ask about their timeline, constraints, priorities first
- Keep responses conversational and brief (2-4 sentences typically)
- After adding milestones, summarize what was added and ask what's next`;

  if (summaries.length > 0) {
    prompt += `\n\nWhat we've discussed before:\n${summaries.join('\n')}`;
  }

  if (milestones.length > 0) {
    prompt += `\n\nCurrent milestones on the timeline:\n`;
    milestones.forEach((m, i) => {
      prompt += `${i + 1}. "${m.title}" - ${m.date} [${m.status}]`;
      if (m.description) prompt += ` - ${m.description}`;
      prompt += ` (id: ${m.id})\n`;
    });
  } else {
    prompt += `\n\nThe timeline is empty - let's figure out what milestones make sense for this project.`;
  }

  return prompt;
}

/**
 * Make API call with model fallback
 */
async function callGroqWithFallback(
  messages: ChatMessage[],
  useTools: boolean = true
): Promise<any> {
  let lastError: Error | null = null;

  for (const model of MODELS) {
    try {
      const body: any = {
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1024
      };

      if (useTools) {
        body.tools = TIMELINE_TOOLS;
        body.tool_choice = 'auto';
      }

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        return await response.json();
      }

      // If rate limited (429), try next model
      if (response.status === 429) {
        console.log(`Rate limited on ${model}, trying next...`);
        lastError = new Error(`Rate limited on ${model}`);
        continue;
      }

      // Other errors, throw
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    } catch (err) {
      lastError = err as Error;
      console.log(`Error with ${model}:`, err);
      continue;
    }
  }

  throw lastError || new Error('All models failed');
}

/**
 * Send a message to the Groq API and handle tool calls
 */
export async function sendChatMessage(
  projectId: string,
  projectName: string,
  userMessage: string,
  chatHistory: ChatMessage[],
  milestones: TimelineMilestone[],
  summaries: string[]
): Promise<{
  response: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  updatedMilestones: TimelineMilestone[];
}> {
  const systemPrompt = buildSystemPrompt(projectName, milestones, summaries);

  // Only keep last 4 messages for context (minimal history)
  const recentHistory = chatHistory.slice(-4);

  // Build messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: userMessage }
  ];

  let allToolCalls: ToolCall[] = [];
  let allToolResults: ToolResult[] = [];
  let finalResponse = '';
  let currentMessages = [...messages];

  // Loop to handle multiple rounds of tool calls
  let iterations = 0;
  const maxIterations = 3;

  while (iterations < maxIterations) {
    iterations++;

    const data = await callGroqWithFallback(currentMessages);
    const assistantMessage = data.choices[0].message;

    // Check if there are tool calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      allToolCalls.push(...assistantMessage.tool_calls);

      // Add assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: assistantMessage.tool_calls
      });

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(projectId, toolCall.function.name, args);

        allToolResults.push({
          tool_call_id: toolCall.id,
          result: result.result,
          success: result.success
        });

        // Add tool result message
        currentMessages.push({
          role: 'tool',
          content: JSON.stringify(result.result),
          tool_call_id: toolCall.id
        });
      }

      // Continue loop to get final response
    } else {
      // No more tool calls, we have the final response
      finalResponse = assistantMessage.content || '';
      break;
    }
  }

  // Get updated milestones after all tool calls
  const updatedMilestones = await storageService.getTimelineMilestones(projectId);

  return {
    response: finalResponse,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    updatedMilestones
  };
}

/**
 * Generate a summary of conversation history
 */
export async function generateChatSummary(
  projectName: string,
  messages: ChatMessage[]
): Promise<string> {
  const prompt = `Summarize this conversation about the project "${projectName}" in 2-3 sentences, focusing on key decisions and timeline changes made:

${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

Summary:`;

  const data = await callGroqWithFallback(
    [{ role: 'user', content: prompt }],
    false // no tools needed
  );
  return data.choices[0].message.content;
}
