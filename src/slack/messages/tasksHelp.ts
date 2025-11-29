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
          '• `@Stirlo tasks today` - Show all tasks due today\n' +
          '• `@Stirlo tasks week` - Show all tasks due this week\n' +
          '• `@Stirlo tasks overdue` - Show all overdue tasks'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*View Your Tasks Only:*\n' +
          '• `@Stirlo my tasks today` - Show YOUR tasks due today\n' +
          '• `@Stirlo my tasks week` - Show YOUR tasks due this week'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Manual Triggers:*\n' +
          '• `@Stirlo trigger daily` - Run daily notifications\n' +
          '• `@Stirlo trigger weekly` - Run weekly notifications'
      }
    },
    {
      type: 'divider'
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: '💡 You can also DM Stirlo with natural requests like: "show my tasks for today"'
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
          text: 'Try `@Stirlo tasks help` to see available commands'
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
