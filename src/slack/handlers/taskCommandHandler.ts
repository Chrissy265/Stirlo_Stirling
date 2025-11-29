import { TaskMonitor } from '../../services/taskMonitor.js';
import { SlackNotifier } from '../../triggers/slackTriggers.js';
import { formatDailySummary } from '../messages/dailySummary.js';
import { formatWeeklySummary } from '../messages/weeklySummary.js';
import { formatTaskAlert } from '../messages/taskAlertMessage.js';
import { formatTasksHelp, formatTasksError } from '../messages/tasksHelp.js';
import { formatPersonalWeeklySummary, formatPersonalDailySummary } from '../messages/personalWeekly.js';
import { getAustralianDate, getStartOfWeek } from '../../utils/dateUtils.js';
import { ParsedTaskCommand, TaskCommandType } from './taskCommandParser.js';
import type { SlackMessage } from '../types.js';
import type { TaskAlert } from '../../types/monitoring.js';

export interface TaskCommandContext {
  userId: string;
  channel: string;
  threadTs?: string;
  messageTs: string;
}

export interface TaskCommandResult {
  message: SlackMessage;
  sendToChannel: boolean;
  isError: boolean;
}

/**
 * Handle parsed task commands
 */
export async function handleTaskCommand(
  command: ParsedTaskCommand,
  context: TaskCommandContext,
  taskMonitor: TaskMonitor,
  slackNotifier: SlackNotifier
): Promise<TaskCommandResult> {
  console.log(`🔧 [TaskCommandHandler] Handling command: ${command.type}`, {
    userId: context.userId,
    channel: context.channel,
    isPersonal: command.isPersonal,
  });
  
  const startTime = Date.now();
  
  try {
    await taskMonitor.logQuery(
      context.userId,
      command.rawText,
      context.channel,
      0
    );

    switch (command.type) {
      case 'tasks_today':
        return await handleTodayQuery(taskMonitor, false);
        
      case 'my_tasks_today':
        return await handleTodayQuery(taskMonitor, true, context.userId);
        
      case 'tasks_week':
        return await handleWeekQuery(taskMonitor, false);
        
      case 'my_tasks_week':
        return await handleWeekQuery(taskMonitor, true, context.userId);
        
      case 'tasks_overdue':
        return await handleOverdueQuery(taskMonitor, false);
        
      case 'trigger_daily':
        return await handleTriggerDaily(taskMonitor, slackNotifier);
        
      case 'trigger_weekly':
        return await handleTriggerWeekly(taskMonitor, slackNotifier);
        
      case 'tasks_help':
        return {
          message: formatTasksHelp(),
          sendToChannel: false,
          isError: false,
        };
        
      default:
        return {
          message: formatTasksHelp(),
          sendToChannel: false,
          isError: false,
        };
    }
  } catch (error) {
    console.error(`❌ [TaskCommandHandler] Error handling command:`, error);
    return {
      message: formatTasksError(
        error instanceof Error ? error.message : 'Something went wrong processing your request.'
      ),
      sendToChannel: false,
      isError: true,
    };
  } finally {
    const responseTimeMs = Date.now() - startTime;
    console.log(`⏱️ [TaskCommandHandler] Command completed in ${responseTimeMs}ms`);
  }
}

async function handleTodayQuery(
  taskMonitor: TaskMonitor,
  isPersonal: boolean,
  userId?: string
): Promise<TaskCommandResult> {
  console.log(`📅 [TaskCommandHandler] Fetching tasks due today`, { isPersonal, userId });
  
  const alerts = await taskMonitor.getTasksOnDemand('today', isPersonal ? userId : undefined);
  
  console.log(`📋 [TaskCommandHandler] Found ${alerts.length} tasks due today`);
  
  if (alerts.length === 0) {
    const message: SlackMessage = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: isPersonal 
              ? '✅ *You have no tasks due today!* Great job staying on top of things! 🎉'
              : '✅ *No tasks due today.* The team is all caught up! 🎉'
          }
        }
      ],
      text: isPersonal ? 'You have no tasks due today!' : 'No tasks due today.'
    };
    
    return {
      message,
      sendToChannel: !isPersonal,
      isError: false,
    };
  }
  
  const today = getAustralianDate();
  const summary = isPersonal 
    ? formatPersonalDailySummary(alerts, today)
    : formatDailySummary(alerts, today);
  
  return {
    message: summary,
    sendToChannel: !isPersonal,
    isError: false,
  };
}

async function handleWeekQuery(
  taskMonitor: TaskMonitor,
  isPersonal: boolean,
  userId?: string
): Promise<TaskCommandResult> {
  console.log(`📅 [TaskCommandHandler] Fetching tasks for this week`, { isPersonal, userId });
  
  const alerts = await taskMonitor.getTasksOnDemand('week', isPersonal ? userId : undefined);
  
  console.log(`📋 [TaskCommandHandler] Found ${alerts.length} tasks this week`);
  
  if (alerts.length === 0) {
    const message: SlackMessage = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: isPersonal 
              ? '✅ *You have no tasks due this week!* Enjoy the clear schedule! 🎉'
              : '✅ *No tasks due this week.* The team has a clear week ahead! 🎉'
          }
        }
      ],
      text: isPersonal ? 'You have no tasks due this week!' : 'No tasks due this week.'
    };
    
    return {
      message,
      sendToChannel: !isPersonal,
      isError: false,
    };
  }
  
  const weekStart = getStartOfWeek(getAustralianDate());
  const summary = isPersonal 
    ? formatPersonalWeeklySummary(alerts, weekStart)
    : formatWeeklySummary(alerts, weekStart);
  
  return {
    message: summary,
    sendToChannel: !isPersonal,
    isError: false,
  };
}

async function handleOverdueQuery(
  taskMonitor: TaskMonitor,
  isPersonal: boolean,
  userId?: string
): Promise<TaskCommandResult> {
  console.log(`🚨 [TaskCommandHandler] Checking for overdue tasks`, { isPersonal, userId });
  
  const alerts = await taskMonitor.getTasksOnDemand('overdue', isPersonal ? userId : undefined);
  
  console.log(`📋 [TaskCommandHandler] Found ${alerts.length} overdue tasks`);
  
  if (alerts.length === 0) {
    const message: SlackMessage = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: isPersonal 
              ? '✅ *You have no overdue tasks!* Keep up the great work! 🎉'
              : '✅ *No overdue tasks.* The team is on schedule! 🎉'
          }
        }
      ],
      text: isPersonal ? 'You have no overdue tasks!' : 'No overdue tasks.'
    };
    
    return {
      message,
      sendToChannel: !isPersonal,
      isError: false,
    };
  }
  
  const message = formatOverdueAlerts(alerts);
  
  return {
    message,
    sendToChannel: !isPersonal,
    isError: false,
  };
}

const MAX_SLACK_BLOCKS = 45;

function formatOverdueAlerts(alerts: TaskAlert[]): SlackMessage {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚨 Overdue Tasks (${alerts.length})`, emoji: true }
    },
    { type: 'divider' }
  ];
  
  const groupedByAssignee = groupBy(alerts, 'assignee');
  let totalTasksShown = 0;
  let truncated = false;
  
  for (const [assignee, assigneeAlerts] of Object.entries(groupedByAssignee)) {
    if (blocks.length >= MAX_SLACK_BLOCKS - 3) {
      truncated = true;
      break;
    }
    
    const displayName = assignee || 'Unassigned';
    
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${displayName}* (${assigneeAlerts.length} overdue)`
      }
    });
    
    for (const alert of assigneeAlerts) {
      if (blocks.length >= MAX_SLACK_BLOCKS - 2) {
        truncated = true;
        break;
      }
      
      const daysOverdue = Math.floor(
        (Date.now() - alert.dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔴 *<${alert.taskUrl}|${alert.taskName}>*\n` +
            `   Due: ${formatDate(alert.dueDate)} (${daysOverdue} days overdue)\n` +
            `   📁 ${alert.boardName}`
        }
      });
      totalTasksShown++;
    }
    
    if (!truncated) {
      blocks.push({ type: 'divider' });
    }
  }
  
  if (truncated) {
    const remaining = alerts.length - totalTasksShown;
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `📋 _...and ${remaining} more overdue task(s). Use \`@Stirlo my overdue\` for your personal list._`
      }]
    });
  }
  
  return {
    blocks,
    text: `🚨 ${alerts.length} Overdue Tasks`
  };
}

async function handleTriggerDaily(
  taskMonitor: TaskMonitor,
  slackNotifier: SlackNotifier
): Promise<TaskCommandResult> {
  console.log(`🚀 [TaskCommandHandler] Triggering daily notifications`);
  
  const teamChannelId = process.env.TEAM_CHANNEL_ID;
  
  if (!teamChannelId) {
    return {
      message: formatTasksError(
        'TEAM_CHANNEL_ID environment variable is not configured. Please set it to the #stirlo-assistant channel ID.'
      ),
      sendToChannel: false,
      isError: true,
    };
  }
  
  const alerts = await taskMonitor.processDailyTasks();
  
  console.log(`📋 [TaskCommandHandler] Found ${alerts.length} tasks for daily notifications`);
  
  const summary = formatDailySummary(alerts, getAustralianDate());
  await slackNotifier.sendToChannel(teamChannelId, summary);
  
  let dmsSent = 0;
  for (const alert of alerts) {
    if (alert.assigneeSlackId) {
      await slackNotifier.sendDirectMessage(alert.assigneeSlackId, formatTaskAlert(alert));
      await taskMonitor.markAlertSent(alert.id);
      dmsSent++;
    }
  }
  
  const resultMessage: SlackMessage = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Daily trigger complete!*\n\n` +
            `• Posted team summary to <#${teamChannelId}>\n` +
            `• Sent ${dmsSent} individual DM notification(s)\n` +
            `• Total tasks: ${alerts.length}`
        }
      }
    ],
    text: `Daily trigger complete! Sent ${alerts.length} notification(s).`
  };
  
  return {
    message: resultMessage,
    sendToChannel: false,
    isError: false,
  };
}

async function handleTriggerWeekly(
  taskMonitor: TaskMonitor,
  slackNotifier: SlackNotifier
): Promise<TaskCommandResult> {
  console.log(`🚀 [TaskCommandHandler] Triggering weekly notifications`);
  
  const teamChannelId = process.env.TEAM_CHANNEL_ID;
  
  if (!teamChannelId) {
    return {
      message: formatTasksError(
        'TEAM_CHANNEL_ID environment variable is not configured. Please set it to the #stirlo-assistant channel ID.'
      ),
      sendToChannel: false,
      isError: true,
    };
  }
  
  const alerts = await taskMonitor.processWeeklyTasks();
  const weekStart = getStartOfWeek(getAustralianDate());
  
  console.log(`📋 [TaskCommandHandler] Found ${alerts.length} tasks for weekly notifications`);
  
  await slackNotifier.sendToChannel(teamChannelId, formatWeeklySummary(alerts, weekStart));
  
  const byAssignee = groupBy(alerts, 'assigneeSlackId');
  let personalSummariesSent = 0;
  
  for (const [slackId, userAlerts] of Object.entries(byAssignee)) {
    if (slackId && slackId !== 'undefined' && slackId !== 'null' && slackId !== '') {
      await slackNotifier.sendDirectMessage(
        slackId,
        formatPersonalWeeklySummary(userAlerts, weekStart)
      );
      personalSummariesSent++;
    }
  }
  
  const resultMessage: SlackMessage = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Weekly trigger complete!*\n\n` +
            `• Posted team summary to <#${teamChannelId}>\n` +
            `• Sent ${personalSummariesSent} personal weekly summaries\n` +
            `• Total tasks for the week: ${alerts.length}`
        }
      }
    ],
    text: `Weekly trigger complete! Sent summary for ${alerts.length} task(s).`
  };
  
  return {
    message: resultMessage,
    sendToChannel: false,
    isError: false,
  };
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', { 
    day: 'numeric', 
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((result, item) => {
    const k = String(item[key] ?? 'null');
    if (!result[k]) result[k] = [];
    result[k].push(item);
    return result;
  }, {} as Record<string, T[]>);
}
