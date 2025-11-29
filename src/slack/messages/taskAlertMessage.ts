import { TaskAlert } from '../../types/monitoring';
import { SlackMessage, SlackBlock, SlackTextObject, SlackButtonElement } from '../types';
import { getUrgencyEmoji, formatDate, safeString, truncateText } from './utils';

export function formatTaskAlert(alert: TaskAlert): SlackMessage {
  const blocks: SlackBlock[] = [];

  const emoji = getUrgencyEmoji(alert);
  const taskName = truncateText(safeString(alert.taskName, 'Untitled Task'), 100);

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${emoji} ${taskName}`, emoji: true }
  });

  const fields: SlackTextObject[] = [
    { type: 'mrkdwn', text: `*Board:*\n${safeString(alert.boardName)}` },
    { type: 'mrkdwn', text: `*Workspace:*\n${safeString(alert.workspaceName)}` },
    { type: 'mrkdwn', text: `*Due:*\n${formatDate(alert.dueDate)}` },
    { type: 'mrkdwn', text: `*Status:*\n${safeString(alert.status)}` },
    { type: 'mrkdwn', text: `*Assigned to:*\n${safeString(alert.assignee, 'Unassigned')}` },
    { type: 'mrkdwn', text: `*Group:*\n${safeString(alert.groupName)}` }
  ];

  blocks.push({
    type: 'section',
    fields
  });

  if (alert.contextualMessage) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: alert.contextualMessage }
    });
  }

  if (alert.relatedDocuments.length > 0) {
    blocks.push({ type: 'divider' });
    const docList = alert.relatedDocuments
      .slice(0, 5)
      .map(doc => `• <${doc.url}|${truncateText(doc.name, 50)}> _(${doc.fileType} - ${doc.source})_`)
      .join('\n');
    
    const moreCount = alert.relatedDocuments.length > 5 
      ? `\n_...and ${alert.relatedDocuments.length - 5} more_` 
      : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📎 Related Documents:*\n${docList}${moreCount}`
      }
    });
  }

  const actionElements: SlackButtonElement[] = [];

  if (alert.taskUrl) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '📋 View in Monday.com', emoji: true },
      url: alert.taskUrl,
      action_id: 'view_task_monday'
    });
  }

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: '✅ Mark Complete', emoji: true },
    style: 'primary',
    action_id: 'complete_task',
    value: JSON.stringify({ taskId: alert.taskId, boardId: alert.boardId, taskName: alert.taskName })
  });

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: '⏰ Snooze', emoji: true },
    action_id: 'snooze_task',
    value: JSON.stringify({ alertId: alert.id, taskId: alert.taskId, taskName: alert.taskName, boardId: alert.boardId })
  });

  blocks.push({
    type: 'actions',
    elements: actionElements
  });

  return {
    blocks,
    text: `${emoji} ${taskName} - Due: ${formatDate(alert.dueDate)}`
  };
}

export function formatTaskAlertCompact(alert: TaskAlert): string {
  const emoji = getUrgencyEmoji(alert);
  const docCount = alert.relatedDocuments.length;
  const docIndicator = docCount > 0 ? ` 📎${docCount}` : '';
  const taskLink = alert.taskUrl 
    ? `<${alert.taskUrl}|${alert.taskName}>` 
    : alert.taskName;
  
  return `${emoji} ${taskLink}${docIndicator} _(${safeString(alert.boardName)})_`;
}
