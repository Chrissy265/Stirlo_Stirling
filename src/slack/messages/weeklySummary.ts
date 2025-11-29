import { TaskAlert } from '../../types/monitoring';
import { SlackMessage, SlackBlock } from '../types';
import { formatShortDate, groupBy, groupByDay, getPriorityEmoji, safeString } from './utils';

export function formatWeeklySummary(alerts: TaskAlert[], weekStart: Date): SlackMessage {
  const blocks: SlackBlock[] = [];

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '📆 Weekly Task Overview', emoji: true }
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Week of ${formatShortDate(weekStart)} - ${formatShortDate(weekEnd)}*\n${alerts.length} task(s) due this week`
    }
  });

  blocks.push({ type: 'divider' });

  if (alerts.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '✨ No tasks scheduled this week!' }
    });
  } else {
    const byDay = groupByDay(alerts);
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    for (const day of days) {
      const dayTasks = byDay[day];
      if (!dayTasks || dayTasks.length === 0) continue;

      const taskList = dayTasks
        .map(t => {
          const emoji = getPriorityEmoji(t.priority);
          const taskLink = t.taskUrl ? `<${t.taskUrl}|${t.taskName}>` : t.taskName;
          const assignee = safeString(t.assignee, 'Unassigned');
          return `${emoji} ${taskLink} - ${assignee}`;
        })
        .join('\n');

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${day}:*\n${taskList}` }
      });
    }

    blocks.push({ type: 'divider' });

    const byAssignee = groupBy(alerts, 'assignee');
    const workloadSummary = Object.entries(byAssignee)
      .map(([assignee, tasks]) => {
        const displayName = assignee === 'null' || assignee === 'undefined' 
          ? 'Unassigned' 
          : assignee;
        return `• ${displayName}: ${tasks.length} task(s)`;
      })
      .join('\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Team Workload:*\n${workloadSummary}` }
    });
  }

  blocks.push({ type: 'divider' });

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '💡 Use `/stirlo-tasks my week` to see your personal weekly view'
    }]
  });

  return {
    blocks,
    text: `📆 Weekly Overview: ${alerts.length} task(s) due this week`
  };
}

export function getWeekStartDate(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
