import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { intelligentAssistant } from "../agents/intelligentAssistant";
import { getClient } from "../../triggers/slackTriggers";

function convertMarkdownToSlackFormat(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, (match, offset, string) => {
      const lineStart = string.lastIndexOf('\n', offset) + 1;
      const num = string.substring(lineStart, offset).match(/\d+/)?.[0] || '1';
      return `${num}. `;
    });
}

function splitTextIntoChunks(text: string, maxChunkSize: number = 2900): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    const potentialChunk = currentChunk ? `${currentChunk}\n${line}` : line;

    if (potentialChunk.length > maxChunkSize) {
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
    } else {
      currentChunk = potentialChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter(chunk => chunk.length <= maxChunkSize);
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
          format: "aisdk",
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
  description: "Send the agent's response back to Slack",
  
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
      logger?.info('💬 [Slack Workflow] Step 2: Starting Slack reply', {
        channel,
        messageTs,
        responseLength: response.length,
      });
      
      const { slack } = await getClient();
      const cleanResponse = convertMarkdownToSlackFormat(response);
      
      try {
        await slack.reactions.remove({
          channel,
          timestamp: messageTs,
          name: "hourglass_flowing_sand",
        });
      } catch (error) {
        logger?.warn('⚠️ [Slack Workflow] Could not remove hourglass reaction');
      }
      
      const chunks = splitTextIntoChunks(cleanResponse, 2900);
      const nonEmptyChunks = chunks.filter(chunk => chunk.trim().length > 0);
      
      if (nonEmptyChunks.length === 0) {
        logger?.warn('⚠️ [Slack Workflow] All chunks were empty, using fallback message');
        nonEmptyChunks.push("I encountered an issue generating a response. Please try asking your question again.");
      }
      
      const blocks = nonEmptyChunks.map(chunk => ({
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: chunk },
      }));
      
      const fallbackText = cleanResponse.trim().substring(0, 3000) || nonEmptyChunks[0];
      
      logger?.info('📤 [Slack Workflow] Step 2: Posting message to Slack', {
        channel,
        threadTs: messageTs,
        blockCount: blocks.length,
      });
      
      const result = await slack.chat.postMessage({
        channel,
        thread_ts: messageTs,
        blocks,
        text: fallbackText,
      });
      
      logger?.info('✅ [Slack Workflow] Step 2: Message posted successfully', {
        messageTs: result.ts,
        ok: result.ok,
        blocksPosted: blocks.length,
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
