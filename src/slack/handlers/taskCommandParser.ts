/**
 * Task Command Parser
 * 
 * Parses @-mention messages for task-related commands.
 * 
 * Supported patterns:
 *   @Stirlo tasks today          - Show tasks due today (team)
 *   @Stirlo tasks week           - Show tasks due this week (team)
 *   @Stirlo tasks overdue        - Show overdue tasks
 *   @Stirlo my tasks today       - Show MY tasks due today
 *   @Stirlo my tasks week        - Show MY tasks due this week
 *   @Stirlo trigger daily        - Manually trigger daily notifications
 *   @Stirlo trigger weekly       - Manually trigger weekly notifications
 *   @Stirlo tasks help           - Show help
 */

export type TaskCommandType = 
  | 'tasks_today'
  | 'tasks_week'
  | 'tasks_overdue'
  | 'my_tasks_today'
  | 'my_tasks_week'
  | 'trigger_daily'
  | 'trigger_weekly'
  | 'tasks_help'
  | null;

export interface ParsedTaskCommand {
  type: TaskCommandType;
  isPersonal: boolean;
  rawText: string;
}

const TASK_PATTERNS: { pattern: RegExp; type: TaskCommandType; isPersonal: boolean }[] = [
  { pattern: /\bmy\s+tasks?\s+today\b/i, type: 'my_tasks_today', isPersonal: true },
  { pattern: /\bmy\s+tasks?\s+week\b/i, type: 'my_tasks_week', isPersonal: true },
  { pattern: /\bmy\s+today\b/i, type: 'my_tasks_today', isPersonal: true },
  { pattern: /\bmy\s+week\b/i, type: 'my_tasks_week', isPersonal: true },
  { pattern: /\bmy\s+tasks?\s+daily\b/i, type: 'my_tasks_today', isPersonal: true },
  { pattern: /\bmy\s+tasks?\s+weekly\b/i, type: 'my_tasks_week', isPersonal: true },
  { pattern: /\btrigger\s+daily\b/i, type: 'trigger_daily', isPersonal: false },
  { pattern: /\btrigger\s+weekly\b/i, type: 'trigger_weekly', isPersonal: false },
  { pattern: /\btasks?\s+today\b/i, type: 'tasks_today', isPersonal: false },
  { pattern: /\btasks?\s+week\b/i, type: 'tasks_week', isPersonal: false },
  { pattern: /\btasks?\s+daily\b/i, type: 'tasks_today', isPersonal: false },
  { pattern: /\btasks?\s+weekly\b/i, type: 'tasks_week', isPersonal: false },
  { pattern: /\btasks?\s+overdue\b/i, type: 'tasks_overdue', isPersonal: false },
  { pattern: /\boverdue\s+tasks?\b/i, type: 'tasks_overdue', isPersonal: false },
  { pattern: /\btoday\s*'?s?\s+tasks?\b/i, type: 'tasks_today', isPersonal: false },
  { pattern: /\bweek\s*'?s?\s+tasks?\b/i, type: 'tasks_week', isPersonal: false },
  { pattern: /\bthis\s+week\s*'?s?\s+tasks?\b/i, type: 'tasks_week', isPersonal: false },
  { pattern: /\btasks?\s+help\b/i, type: 'tasks_help', isPersonal: false },
  { pattern: /\bhelp\s+tasks?\b/i, type: 'tasks_help', isPersonal: false },
];

/**
 * Parse a message to detect if it contains a task command
 * @param text The message text (after bot mention is stripped)
 * @returns ParsedTaskCommand with the detected command type, or null if no command detected
 */
export function parseTaskCommand(text: string): ParsedTaskCommand {
  const normalizedText = text.trim().toLowerCase();
  
  console.log(`🔍 [TaskCommandParser] Parsing text: "${text}"`);
  
  for (const { pattern, type, isPersonal } of TASK_PATTERNS) {
    if (pattern.test(normalizedText)) {
      console.log(`✅ [TaskCommandParser] Matched pattern for: ${type}`);
      return {
        type,
        isPersonal,
        rawText: text,
      };
    }
  }
  
  console.log(`📝 [TaskCommandParser] No task command detected in: "${text}"`);
  return {
    type: null,
    isPersonal: false,
    rawText: text,
  };
}

/**
 * Check if a message contains any task-related keywords (for quick filtering)
 */
export function hasTaskKeywords(text: string): boolean {
  const lowerText = text.toLowerCase();
  const keywords = ['task', 'tasks', 'today', 'week', 'weekly', 'daily', 'overdue', 'trigger'];
  return keywords.some(keyword => lowerText.includes(keyword));
}

/**
 * Strip the bot mention from the message text
 * Handles both user ID mentions (<@U123>) and name mentions (@Stirlo)
 */
export function stripBotMention(text: string, botUserId?: string): string {
  let result = text;
  
  if (botUserId) {
    result = result.replace(new RegExp(`<@${botUserId}>\\s*`, 'gi'), '');
  }
  
  result = result.replace(/<@U[A-Z0-9]+>\s*/gi, '');
  result = result.replace(/@stirlo\s*/gi, '');
  
  return result.trim();
}

/**
 * Format command type for logging/display
 */
export function formatCommandType(type: TaskCommandType): string {
  switch (type) {
    case 'tasks_today': return 'Tasks Today';
    case 'tasks_week': return 'Tasks This Week';
    case 'tasks_overdue': return 'Overdue Tasks';
    case 'my_tasks_today': return 'My Tasks Today';
    case 'my_tasks_week': return 'My Tasks This Week';
    case 'trigger_daily': return 'Trigger Daily Notifications';
    case 'trigger_weekly': return 'Trigger Weekly Notifications';
    case 'tasks_help': return 'Tasks Help';
    default: return 'Unknown Command';
  }
}
