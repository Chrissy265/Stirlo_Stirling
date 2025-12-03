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
import { inngest, inngestServe, registerCronWorkflow } from "./inngest";
import { intelligentAssistant } from "./agents/intelligentAssistant";
import { sharepointSearchTool } from "./tools/sharepointSearchTool";
import { mondaySearchTool, mondayGetUpcomingDeadlinesTool, mondaySearchWithDocsTool, mondayListWorkspacesTool, mondayGetTasksByDateRangeTool } from "./tools/mondayTool";
import { slackPostMessageTool, slackFormatTaskListTool } from "./tools/slackTool";
import { ragSearchTool, ragStoreTool } from "./tools/ragTool";
import { internalSearchOrchestratorTool } from "./tools/internalSearchOrchestratorTool";
import { slackIntelligentAssistantWorkflow } from "./workflows/slackIntelligentAssistantWorkflow";
import { initializeSocketMode, getSlackTestRoute, SlackNotifier, setSlackNotifier, getClient } from "../triggers/slackTriggers";
import { parseTaskCommand, hasTaskKeywords, stripBotMention, handleTaskCommand } from "../slack/handlers";
import { initializeMonitoringServices, getMonitoringServices } from "../services";
import { getChatRoute, getHistoryRoute, getConversationRoute, getHealthRoute } from "../api/lovableRoutes";
import { getDailyCronRoute, getWeeklyCronRoute, getCronStatusRoute } from "../api/cronRoutes";
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

// Log startup information
const startupLogger = console;
const isRender = !!process.env.RENDER;
const isReplit = !!process.env.REPL_ID;
const deploymentEnv = isRender ? 'Render' : isReplit ? 'Replit' : 'Local';

startupLogger.log("🚀 [Mastra] Initializing Mastra instance...", {
  environment: deploymentEnv,
  renderUrl: process.env.RENDER_EXTERNAL_URL,
  hasSlackAppToken: !!process.env.SLACK_APP_TOKEN,
  hasSlackBotToken: !!process.env.SLACK_BOT_TOKEN,
  hasDatabase: !!process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

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
        internalSearchOrchestratorTool,
        sharepointSearchTool,
        mondaySearchTool,
        mondayGetUpcomingDeadlinesTool,
        mondaySearchWithDocsTool,
        mondayListWorkspacesTool,
        mondayGetTasksByDateRangeTool,
        slackPostMessageTool,
        slackFormatTaskListTool,
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
      // Cron trigger endpoints for Render Cron Jobs
      getDailyCronRoute(),
      getWeeklyCronRoute(),
      getCronStatusRoute(),
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
const workflows = Object.keys(mastra.getWorkflows());
const logger = mastra.getLogger();

logger?.info("✅ [Mastra] Validating configuration", {
  workflowCount: workflows.length,
  workflows: workflows,
  agentCount: Object.keys(mastra.getAgents()).length,
  agents: Object.keys(mastra.getAgents()),
});

if (workflows.length > 1) {
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

logger?.info("✅ [Mastra] Configuration validated successfully");

// Register cron-based task monitoring workflows
// Daily monitoring: 8 AM Australian timezone (AEDT/AEST) every day
// Weekly monitoring: 8 AM Australian timezone (AEDT/AEST) on Mondays
// NOTE: These Inngest cron schedules only work when connected to Inngest Cloud
// For Render deployment, use Render Cron Jobs to call /api/cron/daily and /api/cron/weekly
logger?.info("📅 [Cron Workflows] Registering automated task monitoring schedules");

registerCronWorkflow(
  "TZ=Australia/Sydney 0 8 * * *", 
  slackIntelligentAssistantWorkflow,
  "daily-task-monitoring",
  () => mastra,
  'daily-monitoring',
  'stirlo-assistant'
);
logger?.info("✅ [Cron Workflows] Daily monitoring registered (8 AM AEDT/AEST, Mon-Sun)");

registerCronWorkflow(
  "TZ=Australia/Sydney 0 8 * * 1", 
  slackIntelligentAssistantWorkflow,
  "weekly-task-monitoring",
  () => mastra,
  'weekly-monitoring',
  'stirlo-assistant'
);
logger?.info("✅ [Cron Workflows] Weekly monitoring registered (8 AM AEDT/AEST, Mondays)");

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

// Initialize monitoring services for task commands
initializeMonitoringServices().then(() => {
  const logger = mastra.getLogger();
  logger?.info("✅ [Monitoring] Services initialized for task commands");
}).catch((error) => {
  const logger = mastra.getLogger();
  logger?.warn("⚠️ [Monitoring] Failed to initialize services (task commands may not work)", {
    error: format(error),
  });
});

// Initialize Slack Socket Mode connection
// This connects to Slack via WebSocket instead of webhooks
initializeSocketMode({
  mastra,
  handler: async (mastra, triggerInfo) => {
    const logger = mastra.getLogger();
    
    try {
      const { payload } = triggerInfo;
      
      logger?.info("📝 [Slack Trigger] Received message from Socket Mode", { 
        channel: triggerInfo.params.channel,
        channelName: triggerInfo.params.channelDisplayName,
        eventType: payload?.event?.type,
        channelType: payload?.event?.channel_type,
        hasText: !!payload?.event?.text,
        messagePreview: payload?.event?.text?.substring(0, 100),
        hasAuthorizations: !!payload?.authorizations,
        authorizationsLength: payload?.authorizations?.length || 0,
      });

      // Socket Mode already filters to only DMs and app_mentions (in slackTriggers.ts)
      // No need to re-check here - trust the Socket Mode filter
      // The previous redundant check was causing all messages to be discarded because
      // payload.authorizations[0].user_id is often empty in Socket Mode
      
      logger?.info("📝 [Slack Trigger] Processing message (pre-filtered by Socket Mode)", {
        eventType: payload?.event?.type,
        channelType: payload?.event?.channel_type,
        messageLength: payload?.event?.text?.length,
      });

      // Check for task-related commands before running the workflow
      const messageText = payload?.event?.text || '';
      const strippedMessage = stripBotMention(messageText);
      
      if (hasTaskKeywords(strippedMessage)) {
        logger?.info("🔍 [Slack Trigger] Detected task-related keywords, checking for command", {
          strippedMessage: strippedMessage.substring(0, 100),
        });
        
        const parsedCommand = parseTaskCommand(strippedMessage);
        
        if (parsedCommand.type !== null) {
          logger?.info("📋 [Slack Trigger] Task command detected, handling directly", {
            commandType: parsedCommand.type,
            isPersonal: parsedCommand.isPersonal,
          });
          
          // Get monitoring services and slack notifier
          const monitoringServices = getMonitoringServices();
          
          if (!monitoringServices) {
            logger?.error("❌ [Slack Trigger] Monitoring services not initialized");
            return null;
          }
          
          // Get Slack client and create notifier
          const { slack } = await getClient();
          const slackNotifier = new SlackNotifier(slack, logger);
          setSlackNotifier(slackNotifier);
          
          // Handle the task command
          const result = await handleTaskCommand(
            parsedCommand,
            {
              userId: payload.event.user,
              channel: payload.event.channel,
              threadTs: payload.event.thread_ts,
              messageTs: payload.event.ts,
            },
            monitoringServices.taskMonitor,
            slackNotifier
          );
          
          // Send the response to Slack
          const response = await slackNotifier.sendToChannel(
            payload.event.channel,
            result.message,
            payload.event.thread_ts || payload.event.ts
          );
          
          logger?.info("✅ [Slack Trigger] Task command response sent", {
            commandType: parsedCommand.type,
            responseOk: response.ok,
            isError: result.isError,
          });
          
          // Return null to indicate we've handled this message directly
          // (the workflow won't run for task commands)
          return null;
        }
      }

      // Not a task command - run the workflow
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
          triggerType: 'slack',
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
