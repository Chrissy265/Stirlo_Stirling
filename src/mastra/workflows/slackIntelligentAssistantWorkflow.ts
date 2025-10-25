import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { intelligentAssistant } from "../agents/intelligentAssistant";
import { getClient } from "../../triggers/slackTriggers";

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
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
    
    logger?.info('🤖 [Slack Workflow] Step 1: Calling intelligent assistant', {
      threadId,
      messageLength: message.length,
    });
    
    const { text } = await intelligentAssistant.generate(
      [{ role: "user", content: message }],
      {
        resourceId: "slack-bot",
        threadId,
        maxSteps: 5,
      }
    );
    
    logger?.info('✅ [Slack Workflow] Step 1: Got response from assistant', {
      responseLength: text.length,
    });
    
    return {
      response: text,
      channel,
      messageTs,
    };
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
    
    logger?.info('💬 [Slack Workflow] Step 2: Sending reply to Slack', {
      channel,
      responseLength: response.length,
    });
    
    const { slack } = await getClient();
    
    const cleanResponse = stripMarkdownFormatting(response);
    
    logger?.info('📝 [Slack Workflow] Step 2: Cleaned response for natural look', {
      originalLength: response.length,
      cleanedLength: cleanResponse.length,
    });
    
    try {
      await slack.reactions.remove({
        channel,
        timestamp: messageTs,
        name: "hourglass_flowing_sand",
      });
      logger?.info('⏳ [Slack Workflow] Removed hourglass reaction');
    } catch (error) {
      logger?.warn('⚠️  [Slack Workflow] Could not remove hourglass reaction', { error });
    }
    
    await slack.chat.postMessage({
      channel,
      thread_ts: messageTs,
      text: cleanResponse,
    });
    
    logger?.info('✅ [Slack Workflow] Step 2: Reply sent successfully');
    
    return { success: true };
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
