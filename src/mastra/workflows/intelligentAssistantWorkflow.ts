import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { intelligentAssistant } from "../agents/intelligentAssistant";
import { getClient } from "../../triggers/slackTriggers";
import { format } from "node:util";

/**
 * Intelligent Assistant Workflow
 * 
 * Two-step workflow that:
 * 1. Uses the intelligent assistant agent to process user messages
 * 2. Sends the response back to Slack
 */

const useAgentStep = createStep({
  id: "use-intelligent-assistant",
  description: "Process message with intelligent assistant agent",
  
  inputSchema: z.object({
    message: z.string().describe("The Slack message payload as JSON string"),
    threadId: z.string().describe("Thread ID for conversation context"),
  }),
  
  outputSchema: z.object({
    response: z.string().describe("The agent's response text"),
    channel: z.string().describe("Slack channel to reply to"),
    threadTs: z.string().optional().describe("Thread timestamp for replying (optional)"),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('🤖 [Use Agent Step] Starting agent processing', { 
      threadId: inputData.threadId 
    });
    
    try {
      // Parse the Slack message payload
      const payload = JSON.parse(inputData.message);
      const userMessage = payload.event?.text || '';
      const channel = payload.event?.channel || '';
      // Use thread_ts if this is a threaded message, otherwise use event ts as the thread anchor
      const threadTs = payload.event?.thread_ts || payload.event?.ts;
      
      logger?.info('🤖 [Use Agent Step] Parsed message', { 
        userMessage: userMessage.substring(0, 100),
        channel,
        threadTs,
        isThreadedMessage: !!payload.event?.thread_ts
      });
      
      // Call the intelligent assistant agent
      logger?.info('🤖 [Use Agent Step] Calling agent.generate()');
      const { text } = await intelligentAssistant.generate([
        { role: "user", content: userMessage }
      ], {
        resourceId: "slack-bot",
        threadId: inputData.threadId,
        maxSteps: 5, // Allow multi-step tool usage
      });
      
      logger?.info('✅ [Use Agent Step] Agent processing complete', { 
        responseLength: text.length 
      });
      
      return {
        response: text,
        channel,
        threadTs,
      };
    } catch (error: any) {
      logger?.error('❌ [Use Agent Step] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  },
});

const sendSlackReplyStep = createStep({
  id: "send-slack-reply",
  description: "Send agent response back to Slack",
  
  inputSchema: z.object({
    response: z.string().describe("The agent's response text"),
    channel: z.string().describe("Slack channel to reply to"),
    threadTs: z.string().optional().describe("Thread timestamp for replying (optional)"),
  }),
  
  outputSchema: z.object({
    success: z.boolean().describe("Whether the message was sent successfully"),
    messageTs: z.string().optional().describe("Timestamp of the sent message"),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info('💬 [Send Slack Reply] Starting to send response', { 
      channel: inputData.channel,
      responseLength: inputData.response.length 
    });
    
    try {
      // Get the Slack client
      const { slack } = await getClient();
      
      logger?.info('💬 [Send Slack Reply] Posting message to Slack');
      
      // Send the message to Slack
      // Only include thread_ts if it exists (don't send empty string)
      const messageOptions: any = {
        channel: inputData.channel,
        text: inputData.response,
      };
      
      if (inputData.threadTs) {
        messageOptions.thread_ts = inputData.threadTs;
      }
      
      const result = await slack.chat.postMessage(messageOptions);
      
      logger?.info('✅ [Send Slack Reply] Message sent successfully', { 
        messageTs: result.ts 
      });
      
      return {
        success: true,
        messageTs: result.ts,
      };
    } catch (error: any) {
      logger?.error('❌ [Send Slack Reply] Error occurred', { 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  },
});

export const intelligentAssistantWorkflow = createWorkflow({
  id: "intelligent-assistant-workflow",
  description: "Processes Slack messages with the intelligent assistant and sends responses",
  
  inputSchema: z.object({
    message: z.string().describe("The Slack message payload as JSON string"),
    threadId: z.string().describe("Thread ID for conversation context"),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    messageTs: z.string().optional(),
  }),
})
  .then(useAgentStep)
  .then(sendSlackReplyStep)
  .commit();
