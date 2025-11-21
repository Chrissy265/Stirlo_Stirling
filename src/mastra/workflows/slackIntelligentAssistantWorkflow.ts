import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { intelligentAssistant } from "../agents/intelligentAssistant";
import { getClient } from "../../triggers/slackTriggers";
import { mondayGetTasksByDateRangeTool } from "../tools/mondayTool";
import { slackPostMessageTool, slackFormatTaskListTool } from "../tools/slackTool";

function convertMarkdownToSlackFormat(text: string): string {
  return text
    // Convert Markdown links [text](url) to Slack format <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
    // Remove bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

function splitTextIntoChunks(text: string, maxChunkSize: number = 3000): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const lines = text.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';

  for (const line of lines) {
    const potentialChunk = currentChunk ? `${currentChunk}\n${line}` : line;

    if (potentialChunk.length <= maxChunkSize) {
      currentChunk = potentialChunk;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      if (line.length > maxChunkSize) {
        let remainingLine = line;
        while (remainingLine.length > maxChunkSize) {
          const breakPoint = remainingLine.lastIndexOf(' ', maxChunkSize);
          const splitPoint = breakPoint > 0 ? breakPoint : maxChunkSize;
          chunks.push(remainingLine.substring(0, splitPoint));
          remainingLine = remainingLine.substring(splitPoint).trim();
        }
        currentChunk = remainingLine;
      } else {
        currentChunk = line;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter(chunk => chunk.length <= maxChunkSize);
}

// Unified envelope schema for workflow
const workflowEnvelopeSchema = z.object({
  triggerType: z.enum(['slack', 'daily-monitoring', 'weekly-monitoring']),
  slackChannel: z.string().default('stirlo-assistant'),
  success: z.boolean().optional(),
  posted: z.boolean().optional(),
  taskCount: z.number().optional(),
});

// Input schemas
const slackInputSchema = z.object({
  triggerType: z.literal('slack'),
  message: z.string(),
  threadId: z.string(),
  channel: z.string(),
  messageTs: z.string(),
});

const monitoringInputSchema = z.object({
  triggerType: z.enum(['daily-monitoring', 'weekly-monitoring']),
  slackChannel: z.string().default('stirlo-assistant'),
});

const inputSchemaForWorkflow = z.discriminatedUnion('triggerType', [
  slackInputSchema,
  monitoringInputSchema,
]);

// Normalize envelope step - ensures shared invariants
const normalizeEnvelopeStep = createStep({
  id: "normalize-envelope",
  description: "Normalize and validate workflow envelope",
  inputSchema: inputSchemaForWorkflow,
  outputSchema: z.object({
    triggerType: z.enum(['slack', 'daily-monitoring', 'weekly-monitoring']),
    slackChannel: z.string(),
    slackPayload: z.object({
      message: z.string(),
      threadId: z.string(),
      channel: z.string(),
      messageTs: z.string(),
    }).optional(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔄 [Normalize] Normalizing envelope', { triggerType: inputData.triggerType });
    
    if (inputData.triggerType === 'slack') {
      return {
        triggerType: 'slack',
        slackChannel: inputData.channel, // Preserve actual conversation channel
        slackPayload: {
          message: inputData.message,
          threadId: inputData.threadId,
          channel: inputData.channel,
          messageTs: inputData.messageTs,
        },
      };
    }
    
    return {
      triggerType: inputData.triggerType,
      slackChannel: inputData.slackChannel || 'stirlo-assistant',
    };
  },
});

// Router step - handles all three branches internally
const routerStep = createStep({
  id: "route-and-execute",
  description: "Route to appropriate handler based on trigger type",
  inputSchema: z.object({
    triggerType: z.enum(['slack', 'daily-monitoring', 'weekly-monitoring']),
    slackChannel: z.string(),
    slackPayload: z.object({
      message: z.string(),
      threadId: z.string(),
      channel: z.string(),
      messageTs: z.string(),
    }).optional(),
  }),
  outputSchema: workflowEnvelopeSchema,
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔀 [Router] Routing to handler', { triggerType: inputData.triggerType });
    
    // SLACK BRANCH
    if (inputData.triggerType === 'slack' && inputData.slackPayload) {
      const { message, threadId, channel, messageTs } = inputData.slackPayload;
      
      try {
        logger?.info('🤖 [Slack] Starting agent generation');
        
        const { text } = await intelligentAssistant.generate(
          [{ role: "user", content: message }],
          {
            resourceId: "slack-bot",
            threadId,
            maxSteps: 5,
          }
        );
        
        logger?.info('✅ [Slack] Agent generation completed', {
          responseLength: text.length,
        });
        
        // Validate agent response is not empty
        if (!text || text.trim().length === 0) {
          logger?.error('❌ [Slack] Agent returned empty response');
          throw new Error('Agent generated empty response');
        }
        
        // Send reply to Slack
        const { slack } = await getClient();
        const cleanResponse = convertMarkdownToSlackFormat(text);
        
        try {
          await slack.reactions.remove({
            channel,
            timestamp: messageTs,
            name: "hourglass_flowing_sand",
          });
        } catch (error) {
          logger?.warn('⚠️ [Slack] Could not remove hourglass reaction');
        }
        
        // Split into chunks and filter out empty ones
        const chunks = splitTextIntoChunks(cleanResponse, 2900);
        const nonEmptyChunks = chunks.filter(chunk => chunk.trim().length > 0);
        
        // Safety check: ensure we have content to send
        if (nonEmptyChunks.length === 0) {
          logger?.warn('⚠️ [Slack] All chunks were empty after filtering, using fallback message');
          nonEmptyChunks.push("I encountered an issue generating a response. Please try asking your question again.");
        }
        
        const blocks = nonEmptyChunks.map(chunk => ({
          type: "section" as const,
          text: { type: "mrkdwn" as const, text: chunk },
        }));
        
        // Ensure text parameter is always provided (Slack best practice)
        const fallbackText = cleanResponse.trim().substring(0, 3000) || nonEmptyChunks[0];
        
        await slack.chat.postMessage({
          channel,
          thread_ts: messageTs,
          blocks,
          text: fallbackText,
        });
        
        logger?.info('✅ [Slack] Reply posted successfully', {
          chunksCount: nonEmptyChunks.length,
          textLength: fallbackText.length
        });
        
        return {
          triggerType: 'slack',
          slackChannel: inputData.slackChannel,
          success: true,
        };
      } catch (error) {
        logger?.error('❌ [Slack] Handler failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    
    // DAILY MONITORING BRANCH
    if (inputData.triggerType === 'daily-monitoring') {
      logger?.info('📅 [Daily Monitoring] Starting daily task monitoring');
      
      let messagesPosted = 0;
      
      // Fetch and post today's tasks
      const todayResult = await mondayGetTasksByDateRangeTool.execute({
        context: { dateRange: 'today' },
        mastra,
        runtimeContext,
      });
      
      if (todayResult.totalTasks > 0) {
        const todayFormatted = await slackFormatTaskListTool.execute({
          context: {
            tasks: todayResult.tasks,
            title: '🚨 Tasks Due Today',
            dateRange: todayResult.dateRange,
          },
          mastra,
          runtimeContext,
        });
        
        await slackPostMessageTool.execute({
          context: {
            channel: inputData.slackChannel,
            text: todayFormatted.formattedText,
            blocks: todayFormatted.blocks,
          },
          mastra,
          runtimeContext,
        });
        
        messagesPosted++;
        logger?.info('✅ [Daily Monitoring] Today tasks posted', { count: todayResult.totalTasks });
      } else {
        logger?.info('ℹ️ [Daily Monitoring] No tasks due today');
      }
      
      // Fetch and post end-of-week tasks
      const eowResult = await mondayGetTasksByDateRangeTool.execute({
        context: { dateRange: 'end-of-week' },
        mastra,
        runtimeContext,
      });
      
      if (eowResult.totalTasks > 0) {
        const eowFormatted = await slackFormatTaskListTool.execute({
          context: {
            tasks: eowResult.tasks,
            title: '📌 Tasks Due End of Week',
            dateRange: eowResult.dateRange,
          },
          mastra,
          runtimeContext,
        });
        
        await slackPostMessageTool.execute({
          context: {
            channel: inputData.slackChannel,
            text: eowFormatted.formattedText,
            blocks: eowFormatted.blocks,
          },
          mastra,
          runtimeContext,
        });
        
        messagesPosted++;
        logger?.info('✅ [Daily Monitoring] EOW tasks posted', { count: eowResult.totalTasks });
      } else {
        logger?.info('ℹ️ [Daily Monitoring] No tasks due end of week');
      }
      
      return {
        triggerType: 'daily-monitoring',
        slackChannel: inputData.slackChannel,
        success: true,
        posted: messagesPosted > 0, // Only true if we actually posted messages
        taskCount: todayResult.totalTasks + eowResult.totalTasks,
      };
    }
    
    // WEEKLY MONITORING BRANCH
    if (inputData.triggerType === 'weekly-monitoring') {
      logger?.info('📅 [Weekly Monitoring] Starting weekly task overview');
      
      const weeklyResult = await mondayGetTasksByDateRangeTool.execute({
        context: { dateRange: 'upcoming-week' },
        mastra,
        runtimeContext,
      });
      
      if (weeklyResult.totalTasks === 0) {
        const emptyMessage = `✅ *📅 Weekly Task Overview*\n\n_Upcoming Week (Next 7 Days)_\n\nGreat news! No tasks with deadlines in the upcoming week. Enjoy the calm before the storm! 🌴`;
        
        await slackPostMessageTool.execute({
          context: {
            channel: inputData.slackChannel,
            text: emptyMessage,
          },
          mastra,
          runtimeContext,
        });
        
        logger?.info('ℹ️ [Weekly Monitoring] No upcoming tasks');
      } else {
        const weeklyFormatted = await slackFormatTaskListTool.execute({
          context: {
            tasks: weeklyResult.tasks,
            title: '📅 Weekly Task Overview',
            dateRange: weeklyResult.dateRange,
          },
          mastra,
          runtimeContext,
        });
        
        await slackPostMessageTool.execute({
          context: {
            channel: inputData.slackChannel,
            text: weeklyFormatted.formattedText,
            blocks: weeklyFormatted.blocks,
          },
          mastra,
          runtimeContext,
        });
        
        logger?.info('✅ [Weekly Monitoring] Weekly overview posted', { count: weeklyResult.totalTasks });
      }
      
      return {
        triggerType: 'weekly-monitoring',
        slackChannel: inputData.slackChannel,
        success: true,
        posted: true,
        taskCount: weeklyResult.totalTasks,
      };
    }
    
    // Fallback (should never reach here)
    logger?.error('❌ [Router] Unknown trigger type');
    throw new Error(`Unknown trigger type: ${inputData.triggerType}`);
  },
});

export const slackIntelligentAssistantWorkflow = createWorkflow({
  id: "slack-intelligent-assistant",
  description: "Unified orchestrator for Slack messages and automated task monitoring",
  
  inputSchema: inputSchemaForWorkflow,
  outputSchema: workflowEnvelopeSchema,
})
  .then(normalizeEnvelopeStep)
  .then(routerStep)
  .commit();
