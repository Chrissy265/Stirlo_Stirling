import type { Context } from "hono";
import type { Mastra } from "@mastra/core";
import type { ApiRoute } from "@mastra/core/server";

/**
 * POST /api/chat - Handle chat messages from Lovable frontend
 * Accepts: { message: string, user_id: string, session_id: string }
 * Returns: { response: string, timestamp: string, session_id: string }
 */
export function getChatRoute(): ApiRoute {
  return {
    path: "/api/chat",
    method: "POST",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger();
      
      return async (c: Context<any>) => {
        try {
          const body = await c.req.json();
          const { message, user_id, session_id } = body;
          
          logger?.info("📝 [Lovable Chat] Received message", {
            user_id,
            session_id,
            messageLength: message?.length,
          });

          if (!message || !user_id || !session_id) {
            logger?.warn("❌ [Lovable Chat] Missing required fields", { body });
            return c.json({
              error: "Missing required fields: message, user_id, session_id",
            }, 400);
          }

          // Call the intelligent assistant agent
          logger?.info("🤖 [Lovable Chat] Calling intelligent assistant", {
            user_id,
            session_id,
          });

          const agent = mastra.getAgent("intelligentAssistant");
          if (!agent) {
            logger?.error("❌ [Lovable Chat] Agent not found");
            return c.json({ error: "Agent not configured" }, 500);
          }

          const { text } = await agent.generate(
            [{ role: "user", content: message }],
            {
              resourceId: user_id,
              threadId: `lovable/${session_id}`,
              maxSteps: 5,
            }
          );

          logger?.info("✅ [Lovable Chat] Response generated", {
            user_id,
            session_id,
            responseLength: text.length,
          });

          return c.json({
            response: text,
            timestamp: new Date().toISOString(),
            session_id,
          });
        } catch (error) {
          logger?.error("❌ [Lovable Chat] Error processing request", {
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          });
          
          return c.json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error),
          }, 500);
        }
      };
    },
  };
}

/**
 * GET /api/history/:userId - Get conversation threads for a user
 * Returns: Array of conversation threads from Mastra memory
 */
export function getHistoryRoute(): ApiRoute {
  return {
    path: "/api/history/:userId",
    method: "GET",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger();
      
      return async (c: Context<any>) => {
        try {
          const userId = c.req.param("userId");
          
          logger?.info("📚 [Lovable History] Fetching history", { userId });

          if (!userId) {
            return c.json({ error: "Missing userId parameter" }, 400);
          }

          // Get all threads for this user from Mastra memory
          const agent = mastra.getAgent("intelligentAssistant");
          if (!agent) {
            logger?.error("❌ [Lovable History] Agent not found");
            return c.json({ error: "Agent not configured" }, 500);
          }

          const memory = (agent as any).memory;
          if (!memory) {
            logger?.warn("⚠️ [Lovable History] Agent has no memory configured");
            return c.json({ threads: [] });
          }

          // Fetch threads for this resource (user)
          const threads = await memory.getThreads({ resourceId: userId });

          logger?.info("✅ [Lovable History] Threads retrieved", {
            userId,
            threadCount: threads.length,
          });

          return c.json({
            threads: threads.map((thread: any) => ({
              id: thread.id,
              title: thread.title || "Untitled Conversation",
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
              metadata: thread.metadata,
            })),
          });
        } catch (error) {
          logger?.error("❌ [Lovable History] Error fetching history", {
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          });
          
          return c.json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error),
          }, 500);
        }
      };
    },
  };
}

/**
 * GET /api/conversation/:conversationId - Get messages for a specific conversation
 * Returns: Array of messages in the conversation
 */
export function getConversationRoute(): ApiRoute {
  return {
    path: "/api/conversation/:conversationId",
    method: "GET",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger();
      
      return async (c: Context<any>) => {
        try {
          const conversationId = c.req.param("conversationId");
          
          logger?.info("💬 [Lovable Conversation] Fetching conversation", {
            conversationId,
          });

          if (!conversationId) {
            return c.json({ error: "Missing conversationId parameter" }, 400);
          }

          // Get messages for this thread
          const agent = mastra.getAgent("intelligentAssistant");
          if (!agent) {
            logger?.error("❌ [Lovable Conversation] Agent not found");
            return c.json({ error: "Agent not configured" }, 500);
          }

          const memory = (agent as any).memory;
          if (!memory) {
            logger?.warn("⚠️ [Lovable Conversation] Agent has no memory configured");
            return c.json({ messages: [] });
          }

          // Extract threadId from the conversationId (format: lovable/{session_id})
          const threadId = conversationId.startsWith("lovable/")
            ? conversationId
            : `lovable/${conversationId}`;

          const messages = await memory.getMessages({
            threadId,
          });

          logger?.info("✅ [Lovable Conversation] Messages retrieved", {
            conversationId,
            threadId,
            messageCount: messages.length,
          });

          return c.json({
            messages: messages.map((msg: any) => ({
              id: msg.id,
              role: msg.role,
              content: msg.content,
              createdAt: msg.createdAt,
            })),
          });
        } catch (error) {
          logger?.error("❌ [Lovable Conversation] Error fetching conversation", {
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          });
          
          return c.json({
            error: "Internal server error",
            message: error instanceof Error ? error.message : String(error),
          }, 500);
        }
      };
    },
  };
}

/**
 * GET /api/health - Health check endpoint for Lovable
 * Returns: Server status and configuration info
 */
export function getHealthRoute(): ApiRoute {
  return {
    path: "/api/health",
    method: "GET",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger();
      
      return async (c: Context<any>) => {
        try {
          logger?.debug("🏥 [Lovable Health] Health check requested");

          const agents = Object.keys(mastra.getAgents());
          const workflows = Object.keys(mastra.getWorkflows());

          return c.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            service: "SlackGenius API",
            agents,
            workflows,
            endpoints: [
              "POST /api/chat",
              "GET /api/history/:userId",
              "GET /api/conversation/:conversationId",
              "GET /api/health",
            ],
          });
        } catch (error) {
          logger?.error("❌ [Lovable Health] Health check failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          
          return c.json({
            status: "unhealthy",
            error: error instanceof Error ? error.message : String(error),
          }, 500);
        }
      };
    },
  };
}
