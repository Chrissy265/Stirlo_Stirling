import { TaskAlert } from '../../types/monitoring';
import { SlackMessage, SlackBlock } from '../types';
import { formatShortDate, groupBy, safeString, truncateText } from './utils';
import { formatTaskAlertCompact } from './taskAlertMessage';

export function formatDailySummary(alerts: TaskAlert[], date: Date): SlackMessage {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `📅 Tasks Due Today - ${formatShortDate(date)}`, emoji: true }
  });

  const overdueCount = alerts.filter(a => a.alertType === 'overdue').length;
  const dueTodayCount = alerts.filter(a => a.alertType === 'due_today').length;

  let summaryText = `*${alerts.length} task(s)* requiring attention`;
  if (overdueCount > 0) {
    summaryText += ` _(${overdueCount} overdue)_`;
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: summaryText }
  });

  blocks.push({ type: 'divider' });

  if (alerts.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '✨ No tasks due today! Great job staying on top of things.' }
    });
  } else {
    const byAssignee = groupBy(alerts, 'assignee');

    for (const [assignee, tasks] of Object.entries(byAssignee)) {
      const displayName = assignee === 'null' || assignee === 'undefined' 
        ? 'Unassigned' 
        : assignee;

      const taskList = tasks
        .map(t => formatTaskAlertCompact(t))
        .join('\n');

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${displayName}:*\n${taskList}` }
      });
    }
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '💡 Reply with `/stirlo-tasks my today` to see your personal list'
    }]
  });

  return {
    blocks,
    text: `📅 Daily Summary: ${alerts.length} task(s) due today`
  };
}

export function formatOverdueSummary(alerts: TaskAlert[]): SlackMessage {
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '🚨 Overdue Tasks', emoji: true }
  });

  if (alerts.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '✨ No overdue tasks! Everything is on track.' }
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${alerts.length} task(s)* are past their due date:` }
    });

    blocks.push({ type: 'divider' });

    const byAssignee = groupBy(alerts, 'assignee');

    for (const [assignee, tasks] of Object.entries(byAssignee)) {
      const displayName = assignee === 'null' || assignee === 'undefined' 
        ? 'Unassigned' 
        : assignee;

      const taskList = tasks
        .map(t => {
          const daysOverdue = Math.floor((Date.now() - t.dueDate.getTime()) / (1000 * 60 * 60 * 24));
          const overdueText = daysOverdue === 1 ? '1 day' : `${daysOverdue} days`;
          const taskLink = t.taskUrl ? `<${t.taskUrl}|${t.taskName}>` : t.taskName;
          return `🚨 ${taskLink} _(${overdueText} overdue)_`;
        })
        .join('\n');

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${displayName}:*\n${taskList}` }
      });
    }
  }

  return {
    blocks,
    text: `🚨 Overdue: ${alerts.length} task(s) past due date`
  };
}
