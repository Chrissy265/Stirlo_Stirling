import { Mastra } from "@mastra/core";
import { MastraError } from "@mastra/core/error";
import { PinoLogger } from "@mastra/loggers";
import { LogLevel, MastraLogger } from "@mastra/core/logger";
import pino from "pino";
import { MCPServer } from "@mastra/mcp";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { cors } from "hono/cors";

import { sharedPostgresStorage } from "./storage";
import { inngest, inngestServe } from "./inngest";
import { intelligentAssistant } from "./agents/intelligentAssistant";
import { sharepointSearchTool } from "./tools/sharepointSearchTool";
import { mondaySearchTool, mondayGetUpcomingDeadlinesTool } from "./tools/mondayTool";
import { ragSearchTool, ragStoreTool } from "./tools/ragTool";
import { slackIntelligentAssistantWorkflow } from "./workflows/slackIntelligentAssistantWorkflow";
import { initializeSocketMode, getSlackTestRoute } from "../triggers/slackTriggers";
import { getChatRoute, getHistoryRoute, getConversationRoute, getHealthRoute } from "../api/lovableRoutes";
import { format } from "node:util";
import { startKeepAlive } from "../services/keepAlive";

class ProductionPinoLogger extends MastraLogger {
  protected logger: pino.Logger;

  constructor(
    options: {
      name?: string;
      level?: LogLevel;
    } = {},
  ) {
    super(options);

    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label: string, _number: number) => ({
          level: label,
        }),
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    });
  }

  debug(message: string, args: Record<string, any> = {}): void {
    this.logger.debug(args, message);
  }

  info(message: string, args: Record<string, any> = {}): void {
    this.logger.info(args, message);
  }

  warn(message: string, args: Record<string, any> = {}): void {
    this.logger.warn(args, message);
  }

  error(message: string, args: Record<string, any> = {}): void {
    this.logger.error(args, message);
  }
}

export const mastra = new Mastra({
  storage: sharedPostgresStorage,
  // Register your workflows here
  workflows: { slackIntelligentAssistantWorkflow },
  // Register your agents here
  agents: { intelligentAssistant },
  mcpServers: {
    allTools: new MCPServer({
      name: "allTools",
      version: "1.0.0",
      tools: {
        sharepointSearchTool,
        mondaySearchTool,
        mondayGetUpcomingDeadlinesTool,
        ragSearchTool,
        ragStoreTool,
      },
    }),
  },
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: [
      "@slack/web-api",
      "@slack/socket-mode",
      "inngest",
      "inngest/hono",
      "hono",
      "hono/streaming",
    ],
    // sourcemaps are good for debugging.
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5000,
    middleware: [
      // CORS middleware for Lovable frontend integration
      cors({
        origin: (origin) => {
          // Allow specific Lovable domain, any Lovable subdomain, and localhost
          const allowedOrigins = [
            'https://stirlo-ai-assist.lovable.app',
            'http://localhost:5173',
          ];
          if (allowedOrigins.includes(origin)) return origin;
          if (origin.match(/^https:\/\/.*\.lovable\.app$/)) return origin;
          return 'https://stirlo-ai-assist.lovable.app'; // Default allowed origin
        },
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: ['POST', 'GET', 'OPTIONS'],
        exposeHeaders: ['Content-Length'],
        maxAge: 600,
        credentials: true, // Allow credentials with specific origins
      }),
      async (c, next) => {
        const mastra = c.get("mastra");
        const logger = mastra?.getLogger();
        logger?.debug("[Request]", { method: c.req.method, url: c.req.url });
        try {
          await next();
        } catch (error) {
          logger?.error("[Response]", {
            method: c.req.method,
            url: c.req.url,
            error,
          });
          if (error instanceof MastraError) {
            if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
              // This is typically a non-retirable error. It means that the request was not
              // setup correctly to pass in the necessary parameters.
              throw new NonRetriableError(error.message, { cause: error });
            }
          } else if (error instanceof z.ZodError) {
            // Validation errors are never retriable.
            throw new NonRetriableError(error.message, { cause: error });
          }

          throw error;
        }
      },
    ],
    apiRoutes: [
      // This API route is used to register the Mastra workflow (inngest function) on the inngest server
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({ mastra }) => inngestServe({ mastra, inngest }),
        // The inngestServe function integrates Mastra workflows with Inngest by:
        // 1. Creating Inngest functions for each workflow with unique IDs (workflow.${workflowId})
        // 2. Setting up event handlers that:
        //    - Generate unique run IDs for each workflow execution
        //    - Create an InngestExecutionEngine to manage step execution
        //    - Handle workflow state persistence and real-time updates
        // 3. Establishing a publish-subscribe system for real-time monitoring
        //    through the workflow:${workflowId}:${runId} channel
      },
      // Diagnostic test endpoint for Slack
      getSlackTestRoute(),
      // Lovable API endpoints for web frontend integration
      getChatRoute(),
      getHistoryRoute(),
      getConversationRoute(),
      getHealthRoute(),
    ],
  },
  logger:
    process.env.NODE_ENV === "production"
      ? new ProductionPinoLogger({
          name: "Mastra",
          level: "info",
        })
      : new PinoLogger({
          name: "Mastra",
          level: "info",
        }),
});

/*  Sanity check 1: Throw an error if there are more than 1 workflows.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getWorkflows()).length > 1) {
  throw new Error(
    "More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

/*  Sanity check 2: Throw an error if there are more than 1 agents.  */
// !!!!!! Do not remove this check. !!!!!!
if (Object.keys(mastra.getAgents()).length > 1) {
  throw new Error(
    "More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.",
  );
}

// Deduplication cache to prevent duplicate processing when Slack sends both
// 'message' and 'app_mention' events for the same @mention
const processedMessages = new Map<string, number>();
const MESSAGE_CACHE_TTL = 60000; // 60 seconds

// Clean up old entries every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_CACHE_TTL) {
      processedMessages.delete(key);
    }
  }
}, 30000);

// Initialize Keep-Alive service for Render deployment
// Only activates when RENDER env var is present (production on Render)
// Pings /api/health every 5 minutes to prevent app from sleeping
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || "https://stirlo-stirling.onrender.com";
if (process.env.RENDER) {
  const logger = mastra.getLogger();
  logger?.info("🔄 [Keep-Alive] Initializing service for Render deployment", {
    url: RENDER_EXTERNAL_URL,
    intervalMinutes: 5,
  });
  startKeepAlive(RENDER_EXTERNAL_URL, logger);
} else {
  const logger = mastra.getLogger();
  logger?.debug("⏸️  [Keep-Alive] Not on Render, service disabled");
}

// Initialize Slack Socket Mode connection
// This connects to Slack via WebSocket instead of webhooks
initializeSocketMode({
  mastra,
  handler: async (mastra, triggerInfo) => {
    const logger = mastra.getLogger();
    
    try {
      logger?.info("📝 [Slack Trigger] Received message", { 
        channel: triggerInfo.params.channel,
        channelName: triggerInfo.params.channelDisplayName,
        eventType: triggerInfo.payload?.event?.type,
        hasText: !!triggerInfo.payload?.event?.text,
      });

      // By default, respond only to direct messages or mentions
      const { payload } = triggerInfo;
      const isDirectMessage = payload?.event?.channel_type === "im";
      const botUserId = payload?.authorizations?.[0]?.user_id;
      const isMention = botUserId && payload?.event?.text?.includes(`<@${botUserId}>`);
      const shouldRespond = isDirectMessage || isMention;

      logger?.info("📝 [Slack Trigger] Message evaluation", {
        isDirectMessage,
        botUserId,
        isMention,
        shouldRespond,
        messageText: payload?.event?.text?.substring(0, 100),
      });

      if (!shouldRespond) {
        logger?.info("📝 [Slack Trigger] Ignoring message (not DM or mention)");
        return null;
      }

      // Deduplication check: Slack sends both 'message' and 'app_mention' events for @mentions
      const messageId = `${payload.event.channel}:${payload.event.ts}`;
      if (processedMessages.has(messageId)) {
        logger?.info("📝 [Slack Trigger] Ignoring duplicate event", {
          messageId,
          eventType: triggerInfo.payload?.event?.type,
        });
        return null;
      }
      
      // Mark this message as processed
      processedMessages.set(messageId, Date.now());

      // Run the workflow
      logger?.info("🚀 [Slack Trigger] Starting workflow execution", {
        workflowId: "slackIntelligentAssistantWorkflow",
        threadId: `slack/${payload.event.thread_ts || payload.event.ts}`,
        channel: payload.event.channel,
        messageTs: payload.event.ts,
      });
      
      const run = await mastra.getWorkflow("slackIntelligentAssistantWorkflow").createRunAsync();
      
      logger?.info("✅ [Slack Trigger] Workflow run created, starting execution");
      
      const result = await run.start({
        inputData: {
          message: payload.event.text,
          threadId: `slack/${payload.event.thread_ts || payload.event.ts}`,
          channel: payload.event.channel,
          messageTs: payload.event.ts,
        },
      });
      
      logger?.info("✅ [Slack Trigger] Workflow execution completed", {
        result: result ? "success" : "no result",
      });
      
      return result;
    } catch (error) {
      logger?.error("❌ [Slack Trigger] Handler failed", {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType: error?.constructor?.name,
      });
      throw error;
    }
  },
}).catch((error) => {
  const logger = mastra.getLogger();
  logger?.error("❌ [Slack Socket Mode] Failed to initialize", {
    error: format(error),
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
  });
});
