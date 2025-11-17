import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { WebClient } from "@slack/web-api";

async function getSlackClient() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not found in environment");
  }
  return new WebClient(token);
}

export const slackPostMessageTool = createTool({
  id: "slack-post-message",
  description: `Post a formatted message to a Slack channel. Supports rich text formatting with markdown, links, and structured content. Use this for automated notifications and status updates.`,
  
  inputSchema: z.object({
    channel: z.string().describe("Channel name (with or without #) or channel ID to post to"),
    text: z.string().describe("The message text to post (supports Slack markdown formatting)"),
    blocks: z.array(z.any()).optional().describe("Optional Slack Block Kit blocks for rich formatting"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    channel: z.string(),
    timestamp: z.string(),
    messageUrl: z.string().optional(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('💬 [Slack Post] Posting message to channel', { 
      channel: context.channel,
      textPreview: context.text.substring(0, 100)
    });
    
    try {
      const slack = await getSlackClient();
      
      // Remove # from channel name if present
      const channelName = context.channel.startsWith('#') 
        ? context.channel.substring(1) 
        : context.channel;
      
      const params: any = {
        channel: channelName,
        text: context.text,
      };
      
      if (context.blocks && context.blocks.length > 0) {
        params.blocks = context.blocks;
      }
      
      const result = await slack.chat.postMessage(params);
      
      logger?.info('✅ [Slack Post] Message posted successfully', { 
        channel: channelName,
        timestamp: result.ts,
        ok: result.ok
      });
      
      return {
        success: true,
        channel: channelName,
        timestamp: result.ts || '',
        messageUrl: result.ok ? `Posted to #${channelName}` : undefined,
      };
    } catch (error: any) {
      logger?.error('❌ [Slack Post] Failed to post message', { 
        error: error.message,
        channel: context.channel
      });
      throw new Error(`Failed to post Slack message: ${error.message}`);
    }
  },
});

export const slackFormatTaskListTool = createTool({
  id: "slack-format-task-list",
  description: `Format a list of Monday.com tasks into a rich Slack message with proper formatting, links, and grouping. Returns formatted text and optional Block Kit blocks for posting.`,
  
  inputSchema: z.object({
    tasks: z.array(z.object({
      boardName: z.string(),
      boardUrl: z.string(),
      workspaceName: z.string(),
      itemName: z.string(),
      itemUrl: z.string(),
      deadlineFormatted: z.string(),
      assignees: z.array(z.string()),
      status: z.string(),
      priority: z.string().optional(),
    })).describe("Array of task objects to format"),
    title: z.string().describe("Title for the task list (e.g., 'Tasks Due Today')"),
    dateRange: z.string().describe("Description of the date range (e.g., 'Today', 'End of Week')"),
  }),
  
  outputSchema: z.object({
    formattedText: z.string(),
    blocks: z.array(z.any()),
    taskCount: z.number(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('📝 [Slack Format] Formatting task list', { 
      taskCount: context.tasks.length,
      title: context.title
    });
    
    try {
      const { tasks, title, dateRange } = context;
      
      if (tasks.length === 0) {
        const emptyText = `✅ *${title}*\n\nGreat news! No tasks due ${dateRange.toLowerCase()}. Keep up the good work! 🎉`;
        
        return {
          formattedText: emptyText,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: emptyText
              }
            }
          ],
          taskCount: 0,
        };
      }
      
      // Group tasks by board
      const tasksByBoard = new Map<string, typeof tasks>();
      tasks.forEach(task => {
        const existing = tasksByBoard.get(task.boardName) || [];
        existing.push(task);
        tasksByBoard.set(task.boardName, existing);
      });
      
      // Build formatted text
      let formattedText = `📋 *${title}* (${tasks.length} task${tasks.length !== 1 ? 's' : ''})\n`;
      formattedText += `_${dateRange}_\n\n`;
      
      const blocks: any[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${title}`,
            emoji: true
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${dateRange} • ${tasks.length} task${tasks.length !== 1 ? 's' : ''} found`
            }
          ]
        },
        {
          type: "divider"
        }
      ];
      
      // Format each board's tasks
      tasksByBoard.forEach((boardTasks, boardName) => {
        formattedText += `*${boardName}* (${boardTasks.length})\n`;
        
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${boardName}*`
          }
        });
        
        boardTasks.forEach((task, idx) => {
          const assigneeText = task.assignees.length > 0 
            ? `👤 ${task.assignees.join(', ')}` 
            : '👤 Unassigned';
          
          const priorityEmoji = task.priority?.toLowerCase().includes('high') ? '🔴' :
                               task.priority?.toLowerCase().includes('medium') ? '🟡' :
                               task.priority?.toLowerCase().includes('low') ? '🟢' : '';
          
          const priorityText = task.priority && task.priority !== 'Not set' 
            ? `${priorityEmoji} ${task.priority}` 
            : '';
          
          formattedText += `  ${idx + 1}. <${task.itemUrl}|${task.itemName}>\n`;
          formattedText += `     📅 ${task.deadlineFormatted} • ${assigneeText}`;
          if (priorityText) {
            formattedText += ` • ${priorityText}`;
          }
          formattedText += `\n`;
          
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `<${task.itemUrl}|*${task.itemName}*>\n📅 ${task.deadlineFormatted} • ${assigneeText}${priorityText ? ` • ${priorityText}` : ''}`
            }
          });
        });
        
        formattedText += `\n`;
      });
      
      formattedText += `\n🔗 <https://stirling-marketing-net.monday.com|Open Monday.com>`;
      
      blocks.push(
        {
          type: "divider"
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "💡 <https://stirling-marketing-net.monday.com|Open Monday.com> to view all tasks"
            }
          ]
        }
      );
      
      logger?.info('✅ [Slack Format] Task list formatted successfully', { 
        taskCount: tasks.length,
        boardCount: tasksByBoard.size,
        textLength: formattedText.length
      });
      
      return {
        formattedText,
        blocks,
        taskCount: tasks.length,
      };
    } catch (error: any) {
      logger?.error('❌ [Slack Format] Error formatting task list', { 
        error: error.message
      });
      throw new Error(`Failed to format task list: ${error.message}`);
    }
  },
});
