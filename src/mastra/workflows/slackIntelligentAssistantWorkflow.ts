import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { intelligentAssistant } from "../agents/intelligentAssistant";
import { getClient } from "../../triggers/slackTriggers";

function convertMarkdownToSlackFormat(text: string): string {
  return text
    // Convert Markdown links [text](url) to Slack format <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
    // Remove bold formatting ** **
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    // Remove italic formatting * *
    .replace(/\*([^*]+)\*/g, '$1')
    // Remove italic formatting _ _
    .replace(/_([^_]+)_/g, '$1')
    // Remove code formatting ` `
    .replace(/`([^`]+)`/g, '$1')
    // Remove strikethrough ~~ ~~
    .replace(/~~([^~]+)~~/g, '$1')
    // Remove heading markers #
    .replace(/^#+\s+/gm, '')
    // Convert Markdown bullets to simple bullets
    .replace(/^[-*+]\s+/gm, '• ')
    // Preserve numbered lists
    .replace(/^\d+\.\s+/gm, (match, offset, string) => {
      const lineStart = string.lastIndexOf('\n', offset) + 1;
      const num = string.substring(lineStart, offset).match(/\d+/)?.[0] || '1';
      return `${num}. `;
    });
}

const inputSchemaForWorkflow = z.object({
  message: z.string(),
  threadId: z.string(),
  channel: z.string(),
  messageTs: z.string(),
});

const useAgentStep = createStep({
  id: "use-intelligent-assistant",
  description: "Call the intelligent assistant agent with the user's message",
  
  inputSchema: inputSchemaForWorkflow,
  
  outputSchema: z.object({
    response: z.string(),
    channel: z.string(),
    messageTs: z.string(),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { message, threadId, channel, messageTs } = inputData;
    
    try {
      logger?.info('🤖 [Slack Workflow] Step 1: Starting agent generation', {
        threadId,
        channel,
        messageTs,
        messageLength: message.length,
        messagePreview: message.substring(0, 100),
      });
      
      const { text } = await intelligentAssistant.generate(
        [{ role: "user", content: message }],
        {
          resourceId: "slack-bot",
          threadId,
          maxSteps: 5,
        }
      );
      
      logger?.info('✅ [Slack Workflow] Step 1: Agent generation completed', {
        responseLength: text.length,
        responsePreview: text.substring(0, 200),
      });
      
      return {
        response: text,
        channel,
        messageTs,
      };
    } catch (error) {
      logger?.error('❌ [Slack Workflow] Step 1: Agent generation FAILED', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType: error?.constructor?.name,
        threadId,
        channel,
        messageTs,
      });
      throw error;
    }
  },
});

const sendReplyStep = createStep({
  id: "send-slack-reply",
  description: "Send the assistant's response back to Slack with clean, natural formatting",
  
  inputSchema: z.object({
    response: z.string(),
    channel: z.string(),
    messageTs: z.string(),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { response, channel, messageTs } = inputData;
    
    try {
      logger?.info('💬 [Slack Workflow] Step 2: Starting Slack reply process', {
        channel,
        messageTs,
        responseLength: response.length,
        responsePreview: response.substring(0, 200),
      });
      
      logger?.info('🔌 [Slack Workflow] Step 2: Getting Slack client');
      const { slack } = await getClient();
      logger?.info('✅ [Slack Workflow] Step 2: Slack client obtained');
      
      const cleanResponse = convertMarkdownToSlackFormat(response);
      
      logger?.info('📝 [Slack Workflow] Step 2: Response cleaned for natural formatting', {
        originalLength: response.length,
        cleanedLength: cleanResponse.length,
        cleanedPreview: cleanResponse.substring(0, 200),
      });
      
      try {
        logger?.info('⏳ [Slack Workflow] Step 2: Removing hourglass reaction');
        await slack.reactions.remove({
          channel,
          timestamp: messageTs,
          name: "hourglass_flowing_sand",
        });
        logger?.info('✅ [Slack Workflow] Step 2: Hourglass reaction removed');
      } catch (error) {
        logger?.warn('⚠️  [Slack Workflow] Step 2: Could not remove hourglass reaction', { 
          error: error instanceof Error ? error.message : String(error),
        });
      }
      
      logger?.info('📤 [Slack Workflow] Step 2: Posting message to Slack', {
        channel,
        threadTs: messageTs,
        messageLength: cleanResponse.length,
      });
      
      const result = await slack.chat.postMessage({
        channel,
        thread_ts: messageTs,
        text: cleanResponse,
      });
      
      logger?.info('✅ [Slack Workflow] Step 2: Message posted successfully', {
        messageTs: result.ts,
        ok: result.ok,
      });
      
      return { success: true };
    } catch (error) {
      logger?.error('❌ [Slack Workflow] Step 2: Slack reply FAILED', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType: error?.constructor?.name,
        channel,
        messageTs,
      });
      throw error;
    }
  },
});

export const slackIntelligentAssistantWorkflow = createWorkflow({
  id: "slack-intelligent-assistant",
  description: "Slack workflow that uses the intelligent assistant to respond to messages",
  
  inputSchema: inputSchemaForWorkflow,
  
  outputSchema: z.object({
    success: z.boolean(),
  }),
})
  .then(useAgentStep)
  .then(sendReplyStep)
  .commit();
