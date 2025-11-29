import { SlackMessage, SlackBlock } from '../types';

export function formatTasksHelp(): SlackMessage {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📋 Stirlo Task Commands', emoji: true }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*View Tasks (Team-wide):*\n' +
          '• `/stirlo-tasks today` - Show all tasks due today\n' +
          '• `/stirlo-tasks week` - Show all tasks due this week\n' +
          '• `/stirlo-tasks overdue` - Show all overdue tasks'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*View Your Tasks Only:*\n' +
          '• `/stirlo-tasks my today` - Show YOUR tasks due today\n' +
          '• `/stirlo-tasks my week` - Show YOUR tasks due this week\n' +
          '• `/stirlo-tasks my overdue` - Show YOUR overdue tasks'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Manual Triggers (Admin Only):*\n' +
          '• `/stirlo-tasks trigger daily` - Run daily notifications\n' +
          '• `/stirlo-tasks trigger weekly` - Run weekly notifications'
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: '💡 You can also DM Stirlo: "show my tasks for today"'
      }]
    }
  ];

  return {
    blocks,
    text: '📋 Stirlo Task Commands - Help'
  };
}

export function formatTasksError(error: string): SlackMessage {
  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ *Error:* ${error}`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: 'Use `/stirlo-tasks help` to see available commands'
        }]
      }
    ],
    text: `Error: ${error}`
  };
}

export function formatTasksLoading(): SlackMessage {
  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⏳ Fetching your tasks from Monday.com...'
        }
      }
    ],
    text: 'Loading tasks...'
  };
}
