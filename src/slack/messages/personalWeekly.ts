import { TaskAlert } from '../../types/monitoring';
import { SlackMessage, SlackBlock, SlackButtonElement } from '../types';
import { formatShortDate, formatDayName, sortByDueDate, safeString, getPriorityEmoji } from './utils';

export function formatPersonalWeeklySummary(
  alerts: TaskAlert[], 
  weekStart: Date,
  slackUserId?: string
): SlackMessage {
  const blocks: SlackBlock[] = [];

  const filteredAlerts = slackUserId 
    ? alerts.filter(a => a.assigneeSlackId === slackUserId)
    : alerts;

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '🗓️ Your Week Ahead', emoji: true }
  });

  if (filteredAlerts.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '✨ You have no tasks due this week! Enjoy the breather.'
      }
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `You have *${filteredAlerts.length} task(s)* due this week:`
      }
    });

    const sorted = sortByDueDate(filteredAlerts);

    for (const alert of sorted) {
      const dayName = formatDayName(alert.dueDate);
      const priorityEmoji = getPriorityEmoji(alert.priority);
      
      const accessory: SlackButtonElement | undefined = alert.taskUrl ? {
        type: 'button',
        text: { type: 'plain_text', text: 'View', emoji: true },
        url: alert.taskUrl,
        action_id: `view_personal_task_${alert.taskId}`
      } : undefined;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${priorityEmoji} *${alert.taskName}*\n  Due: ${dayName}, ${formatShortDate(alert.dueDate)} | Board: ${safeString(alert.boardName)}`
        },
        accessory
      });
    }
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '💡 Use `/stirlo-tasks my today` to focus on just today\'s tasks'
    }]
  });

  return {
    blocks,
    text: `🗓️ Your Week: ${filteredAlerts.length} task(s) due`
  };
}

export function formatPersonalDailySummary(
  alerts: TaskAlert[],
  date: Date,
  slackUserId?: string
): SlackMessage {
  const blocks: SlackBlock[] = [];

  const filteredAlerts = slackUserId 
    ? alerts.filter(a => a.assigneeSlackId === slackUserId)
    : alerts;

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '📋 Your Tasks Today', emoji: true }
  });

  if (filteredAlerts.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '✨ No tasks due today! You\'re all caught up.'
      }
    });
  } else {
    const overdueCount = filteredAlerts.filter(a => a.alertType === 'overdue').length;
    let summary = `You have *${filteredAlerts.length} task(s)* due today`;
    if (overdueCount > 0) {
      summary += ` _(${overdueCount} overdue)_`;
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: summary }
    });

    blocks.push({ type: 'divider' });

    const sorted = sortByDueDate(filteredAlerts);

    for (const alert of sorted) {
      const isOverdue = alert.alertType === 'overdue';
      const emoji = isOverdue ? '🚨' : '📋';
      
      const accessory: SlackButtonElement | undefined = alert.taskUrl ? {
        type: 'button',
        text: { type: 'plain_text', text: 'View', emoji: true },
        url: alert.taskUrl,
        action_id: `view_personal_task_${alert.taskId}`
      } : undefined;

      const overdueNote = isOverdue 
        ? ` _(overdue)_` 
        : '';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${alert.taskName}*${overdueNote}\n  Board: ${safeString(alert.boardName)} | Status: ${safeString(alert.status)}`
        },
        accessory
      });
    }
  }

  return {
    blocks,
    text: `📋 Today: ${filteredAlerts.length} task(s)`
  };
}
