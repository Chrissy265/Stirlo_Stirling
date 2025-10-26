import { format } from "node:util";
import { Mastra, type WorkflowResult, type Step } from "@mastra/core";
import { IMastraLogger } from "@mastra/core/logger";
import {
  type AuthTestResponse,
  type ChatPostMessageResponse,
  type ConversationsOpenResponse,
  type ConversationsRepliesResponse,
  type UsersConversationsResponse,
  type WebAPICallError,
  ErrorCode,
  WebClient,
} from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";
import type { Context, Handler, MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";

export type Methods = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL";

// TODO: Remove when Mastra exports this type.
export type ApiRoute =
  | {
      path: string;
      method: Methods;
      handler: Handler;
      middleware?: MiddlewareHandler | MiddlewareHandler[];
    }
  | {
      path: string;
      method: Methods;
      createHandler: ({ mastra }: { mastra: Mastra }) => Promise<Handler>;
      middleware?: MiddlewareHandler | MiddlewareHandler[];
    };

export type TriggerInfoSlackOnNewMessage = {
  type: "slack/message.channels";
  params: {
    channel: string;
    channelDisplayName: string;
  };
  payload: any;
};

type DiagnosisStep =
  | {
      status: "pending";
      name: string;
      extra?: Record<string, any>;
    }
  | {
      status: "success";
      name: string;
      extra: Record<string, any>;
    }
  | {
      status: "failed";
      name: string;
      error: string;
      extra: Record<string, any>;
    };

export async function getClient() {
  // Check for manual environment variable first (user-provided secrets)
  const manualToken = process.env.SLACK_BOT_TOKEN;
  
  if (manualToken) {
    // Use manually configured token from Replit Secrets
    console.log("🔌 [Slack] Using SLACK_BOT_TOKEN from environment");
    const slack = new WebClient(manualToken);
    const response = await slack.auth.test();
    return { slack, auth: response, user: undefined };
  }

  // Fall back to connector approach if no manual token
  console.log("🔌 [Slack] SLACK_BOT_TOKEN not found in environment, trying connector");
  let connectionSettings: any;
  async function getAccessToken() {
    if (
      connectionSettings &&
      connectionSettings.settings.expires_at &&
      new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
    ) {
      return {
        token: connectionSettings.settings.access_token,
        user: connectionSettings.settings.oauth?.credentials?.raw?.authed_user
          ?.id,
      };
    }

    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? "depl " + process.env.WEB_REPL_RENEWAL
        : null;

    if (!xReplitToken) {
      throw new Error("X_REPLIT_TOKEN not found for repl/depl");
    }

    const res = await fetch(
      "https://" +
        hostname +
        "/api/v2/connection?include_secrets=true&connector_names=slack-agent",
      {
        headers: {
          Accept: "application/json",
          X_REPLIT_TOKEN: xReplitToken,
        },
      },
    );
    const resJson = await res.json();
    connectionSettings = resJson?.items?.[0];
    if (!connectionSettings || !connectionSettings.settings.access_token) {
      throw new Error(
        `Slack not connected: HTTP ${res.status} ${res.statusText}: ${JSON.stringify(resJson)}`,
      );
    }
    return {
      token: connectionSettings.settings.access_token,
      user: connectionSettings.settings.oauth?.credentials?.raw?.authed_user
        ?.id,
    };
  }

  const { token, user } = await getAccessToken();
  console.log("🔌 [Slack] Using bot token from connector");
  const slack = new WebClient(token);

  const response = await slack.auth.test();

  return { slack, auth: response, user };
}

// Keep up to 200 recent events, to prevent duplicates
const recentEvents: string[] = [];

function isWebAPICallError(err: unknown): err is WebAPICallError {
  return (
    err !== null && typeof err === "object" && "code" in err && "data" in err
  );
}

function checkDuplicateEvent(eventName: string) {
  if (recentEvents.includes(eventName)) {
    return true;
  }
  recentEvents.push(eventName);
  if (recentEvents.length > 200) {
    recentEvents.shift();
  }
  return false;
}

function createReactToMessage<
  TState extends z.ZodObject<any>,
  TInput extends z.ZodType<any>,
  TOutput extends z.ZodType<any>,
  TSteps extends Step<string, any, any>[],
>({ slack, logger }: { slack: WebClient; logger: IMastraLogger }) {
  const addReaction = async (
    channel: string,
    timestamp: string,
    emoji: string,
  ) => {
    logger.info(`[Slack] Adding reaction to message`, {
      emoji,
      timestamp,
      channel,
    });
    try {
      await slack.reactions.add({ channel, timestamp, name: emoji });
    } catch (error) {
      logger.error(`[Slack] Error adding reaction to message`, {
        emoji,
        timestamp,
        channel,
        error: format(error),
      });
    }
  };

  const removeAllReactions = async (channel: string, timestamp: string) => {
    logger.info(`[Slack] Removing all reactions from message`, {
      timestamp,
      channel,
    });
    const emojis = [
      "hourglass",
      "hourglass_flowing_sand",
      "white_check_mark",
      "x",
      "alarm_clock",
    ];

    for (const emoji of emojis) {
      try {
        await slack.reactions.remove({ channel, timestamp, name: emoji });
      } catch (error) {
        if (
          isWebAPICallError(error) &&
          (error.code !== ErrorCode.PlatformError ||
            error.data?.error !== "no_reaction")
        ) {
          logger.error("[Slack] Error removing reaction", {
            emoji,
            timestamp,
            channel,
            error: format(error),
          });
        }
      }
    }
  };

  return async function reactToMessage(
    channel: string,
    timestamp: string,
    result: WorkflowResult<TState, TInput, TOutput, TSteps> | null,
  ) {
    // Remove all of our reactions.
    await removeAllReactions(channel, timestamp);
    if (result?.status === "success") {
      await addReaction(channel, timestamp, "white_check_mark");
    } else if (result?.status === "failed") {
      await addReaction(channel, timestamp, "x");
    } else if (result !== null) {
      await addReaction(channel, timestamp, "alarm_clock");
    }
  };
}

// Socket Mode implementation for Slack
let socketClient: SocketModeClient | null = null;

export async function initializeSocketMode<
  TState extends z.ZodObject<any>,
  TInput extends z.ZodType<any>,
  TOutput extends z.ZodType<any>,
  TSteps extends Step<string, any, any>[],
>({
  mastra,
  handler,
}: {
  mastra: Mastra;
  handler: (
    mastra: Mastra,
    triggerInfo: TriggerInfoSlackOnNewMessage,
  ) => Promise<WorkflowResult<TState, TInput, TOutput, TSteps> | null>;
}) {
  const logger = mastra.getLogger();
  
  logger?.info("🔌 [Slack Socket Mode] Initializing Socket Mode connection");

  // Try to get app token from manual environment variable first
  let appToken = process.env.SLACK_APP_TOKEN;
  
  if (!appToken) {
    // Fall back to connector approach for app token
    logger?.info("🔌 [Slack Socket Mode] SLACK_APP_TOKEN not found in environment, trying connector");
    
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? "depl " + process.env.WEB_REPL_RENEWAL
        : null;

    if (xReplitToken && hostname) {
      try {
        const res = await fetch(
          "https://" +
            hostname +
            "/api/v2/connection?include_secrets=true&connector_names=slack-agent",
          {
            headers: {
              Accept: "application/json",
              X_REPLIT_TOKEN: xReplitToken,
            },
          },
        );
        const resJson = await res.json();
        const connectionSettings = resJson?.items?.[0];
        
        if (connectionSettings?.settings?.app_token) {
          appToken = connectionSettings.settings.app_token;
          logger?.info("🔌 [Slack Socket Mode] Using app token from connector");
        }
      } catch (error) {
        logger?.warn("🔌 [Slack Socket Mode] Failed to fetch app token from connector", {
          error: format(error),
        });
      }
    }
  } else {
    logger?.info("🔌 [Slack Socket Mode] Using SLACK_APP_TOKEN from environment");
  }

  if (!appToken) {
    throw new Error("SLACK_APP_TOKEN not found in environment variables or connector settings");
  }

  // Get Slack client
  const { slack, auth } = await getClient();
  const reactToMessage = createReactToMessage({ slack, logger });

  logger?.info("🔌 [Slack Socket Mode] Bot authenticated", { 
    botId: auth.bot_id, 
    userId: auth.user_id 
  });

  // Create Socket Mode client
  socketClient = new SocketModeClient({ 
    appToken,
  });

  // Listen to all Socket Mode events
  socketClient.on("slack_event", async ({ body, ack }) => {
    logger?.info("📝 [Slack Socket Mode] Received event - FULL BODY", { 
      type: body.type,
      envelopeId: body.envelope_id,
      bodyKeys: Object.keys(body),
      fullBody: JSON.stringify(body, null, 2),
    });

    try {
      // Acknowledge the event immediately
      await ack();

      // Handle the event - Socket Mode wraps events in a payload object
      // Slack sends either "events_api" or "event_callback" depending on the event source
      if ((body.type === "events_api" || body.type === "event_callback") && body.payload?.event) {
        const event = body.payload.event;
        const payload = body.payload;

        logger?.info("📝 [Slack Socket Mode] Processing event", { 
          eventType: event.type,
          channel: event.channel,
          user: event.user,
          text: event.text?.substring(0, 50)
        });

        // Only process message and app_mention events
        if (event.type !== "message" && event.type !== "app_mention") {
          logger?.info("📝 [Slack Socket Mode] Ignoring non-message event", { 
            eventType: event.type 
          });
          return;
        }

        // Ignore message subtypes we don't want
        if (
          event.subtype === "message_changed" ||
          event.subtype === "message_deleted"
        ) {
          logger?.info("📝 [Slack Socket Mode] Ignoring message subtype", { 
            subtype: event.subtype 
          });
          return;
        }

        // Ignore bot messages
        if (event.bot_id) {
          logger?.info("📝 [Slack Socket Mode] Ignoring bot message");
          return;
        }

        // Check for duplicates
        if (checkDuplicateEvent(payload.event_id)) {
          logger?.info("📝 [Slack Socket Mode] Duplicate event, ignoring");
          return;
        }

        // Handle test:ping command
        if (
          (event.channel_type === "im" && event.text === "test:ping") ||
          event.text === `<@${auth.user_id}> test:ping`
        ) {
          await slack.chat.postMessage({
            channel: event.channel,
            text: "pong",
            thread_ts: event.ts,
          });
          logger?.info("📝 [Slack Socket Mode] pong");
          return;
        }

        // Get channel info
        let channelInfo: any = {};
        if (event.channel) {
          try {
            const result = await slack.conversations.info({
              channel: event.channel,
            });
            channelInfo = result.channel;
            logger?.info("📝 [Slack Socket Mode] Got channel info", { 
              channelName: channelInfo.name 
            });
          } catch (error) {
            logger?.error("📝 [Slack Socket Mode] Error fetching channel info", {
              error: format(error),
            });
          }
        }

        // React with hourglass to show processing
        try {
          await slack.reactions.add({
            channel: event.channel,
            timestamp: event.ts,
            name: "hourglass_flowing_sand",
          });
        } catch (error) {
          logger?.error("📝 [Slack Socket Mode] Error adding reaction", {
            error: format(error),
          });
        }

        // Call the handler with the correct payload structure
        const result = await handler(mastra, {
          type: "slack/message.channels",
          params: {
            channel: event.channel,
            channelDisplayName: channelInfo.name || event.channel,
          },
          payload: payload,
        });

        logger?.info("📝 [Slack Socket Mode] Handler completed", { 
          status: result?.status 
        });

        // React based on result
        await reactToMessage(event.channel, event.ts, result);
      }
    } catch (error) {
      logger?.error("❌ [Slack Socket Mode] Error processing event", {
        error: format(error),
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  // Listen to errors
  socketClient.on("error", (error) => {
    logger?.error("❌ [Slack Socket Mode] Socket error", {
      error: format(error),
    });
  });

  // Listen to disconnection
  socketClient.on("disconnect", () => {
    logger?.warn("⚠️ [Slack Socket Mode] Disconnected from Slack");
  });

  // Listen to reconnection
  socketClient.on("ready", () => {
    logger?.info("✅ [Slack Socket Mode] Connected and ready");
  });

  // Start the client
  await socketClient.start();
  
  logger?.info("🚀 [Slack Socket Mode] Socket Mode client started successfully");
}

// Diagnostic test endpoint
export function getSlackTestRoute(): ApiRoute {
  return {
    path: "/test/slack",
    method: "GET",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger() ?? {
        info: console.log,
        error: console.error,
      };
      
      return async (c: Context<any>) => {
        return streamSSE(c, async (stream) => {
          let id = 1;

          let diagnosisStepAuth: DiagnosisStep = {
            status: "pending",
            name: "authentication with Slack",
          };
          let diagnosisStepConversation: DiagnosisStep = {
            status: "pending",
            name: "open a conversation with user",
          };
          let diagnosisStepPostMessage: DiagnosisStep = {
            status: "pending",
            name: "send a message to the user",
          };
          let diagnosisStepReadReplies: DiagnosisStep = {
            status: "pending",
            name: "read replies from bot",
          };
          const updateDiagnosisSteps = async (event: string) =>
            stream.writeSSE({
              data: JSON.stringify([
                diagnosisStepAuth,
                diagnosisStepConversation,
                diagnosisStepPostMessage,
                diagnosisStepReadReplies,
              ]),
              event,
              id: String(id++),
            });

          let slack: WebClient;
          let auth: AuthTestResponse;
          let user: string | undefined;
          try {
            ({ slack, auth, user } = await getClient());
          } catch (error) {
            logger?.error("❌ [Slack] test:auth failed", {
              error: format(error),
            });
            diagnosisStepAuth = {
              ...diagnosisStepAuth,
              status: "failed",
              error: "authentication failed",
              extra: { error: format(error) },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          if (!auth?.user_id) {
            logger?.error("❌ [Slack] test:auth not working", {
              auth,
            });
            diagnosisStepAuth = {
              ...diagnosisStepAuth,
              status: "failed",
              error: "authentication failed",
              extra: { auth },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          diagnosisStepAuth = {
            ...diagnosisStepAuth,
            status: "success",
            extra: { auth },
          };
          await updateDiagnosisSteps("progress");

          logger?.info("📝 [Slack] test:auth found", { auth });

          let channel: ConversationsOpenResponse["channel"];
          if (user) {
            // Open a DM with itself.
            let conversationsResponse: ConversationsOpenResponse;
            try {
              conversationsResponse = await slack.conversations.open({
                users: user,
              });
            } catch (error) {
              logger?.error("❌ [Slack] test:conversation not found", {
                error: format(error),
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "opening a conversation failed",
                extra: { error: format(error) },
              };
              await updateDiagnosisSteps("error");
              return;
            }

            if (!conversationsResponse?.channel?.id) {
              logger?.error("❌ [Slack] test:conversation not found", {
                conversationsResponse,
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "conversation channel not found",
                extra: { conversationsResponse },
              };
              await updateDiagnosisSteps("error");
              return;
            }

            channel = conversationsResponse.channel;
          } else {
            // Find the first channel where the bot is installed.
            let conversationsResponse: UsersConversationsResponse;
            try {
              conversationsResponse = await slack.users.conversations({
                user: auth.user_id,
              });
            } catch (error) {
              logger?.error("❌ [Slack] test:conversation not found", {
                error: format(error),
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "opening a conversation failed",
                extra: { error: format(error) },
              };
              await updateDiagnosisSteps("error");
              return;
            }

            if (!conversationsResponse?.channels?.length) {
              logger?.error("❌ [Slack] test:channel not found", {
                conversationsResponse,
              });
              diagnosisStepConversation = {
                ...diagnosisStepConversation,
                status: "failed",
                error: "channel not found",
                extra: { conversationsResponse },
              };
              await updateDiagnosisSteps("error");
              return;
            }
            channel = conversationsResponse.channels![0]!;
          }

          if (!channel.id) {
            logger?.error("❌ [Slack] test:channel not found", {
              channel,
            });
            diagnosisStepConversation = {
              ...diagnosisStepConversation,
              status: "failed",
              error: "channel not found",
              extra: { channel },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          diagnosisStepConversation = {
            ...diagnosisStepConversation,
            status: "success",
            extra: { channel },
          };
          await updateDiagnosisSteps("progress");

          logger?.info("📝 [Slack] test:channel found", { channel });

          // Post a message in the DMs.
          let message: ChatPostMessageResponse;
          try {
            message = await slack.chat.postMessage({
              channel: channel.id,
              text: `<@${auth.user_id}> test:ping`,
            });
          } catch (error) {
            logger?.error("❌ [Slack] test:message not posted", {
              error: format(error),
            });
            diagnosisStepPostMessage = {
              ...diagnosisStepPostMessage,
              status: "failed",
              error: "posting message failed",
              extra: { error: format(error) },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          if (!message?.ts) {
            logger?.error("❌ [Slack] test:message not posted", { message });
            diagnosisStepPostMessage = {
              ...diagnosisStepPostMessage,
              status: "failed",
              error: "posting message missing timestamp",
              extra: { message },
            };
            await updateDiagnosisSteps("error");
            return;
          }

          logger?.info("📝 [Slack] test:ping sent", { message });

          diagnosisStepPostMessage = {
            ...diagnosisStepPostMessage,
            status: "success",
            extra: { message },
          };
          await updateDiagnosisSteps("progress");

          const sleep = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));

          // Wait for the bot to reply.
          let lastReplies: ConversationsRepliesResponse | undefined = undefined;
          for (let i = 0; i < 30; i++) {
            await sleep(1000);
            let replies: ConversationsRepliesResponse;
            try {
              replies = await slack.conversations.replies({
                ts: message.ts,
                channel: channel.id,
              });
            } catch (error) {
              logger?.error("❌ [Slack] test:replies not found", { message });
              diagnosisStepReadReplies = {
                ...diagnosisStepReadReplies,
                status: "failed",
                error: "replies not found",
                extra: { error: format(error) },
              };
              await updateDiagnosisSteps("error");
              return;
            }
            logger?.info("📝 [Slack] test:replies", { replies });
            diagnosisStepReadReplies.extra = { replies };
            lastReplies = replies;
            if (replies?.messages?.some((m) => m.text === "pong")) {
              // Victory!
              logger?.info("📝 [Slack] test:pong successful");
              diagnosisStepReadReplies = {
                ...diagnosisStepReadReplies,
                status: "success",
                extra: { replies },
              };
              await updateDiagnosisSteps("result");
              return;
            }

            await updateDiagnosisSteps("progress");
          }

          logger?.error("❌ [Slack] test:timeout");

          diagnosisStepReadReplies = {
            ...diagnosisStepReadReplies,
            status: "failed",
            error: "replies timed out",
            extra: { lastReplies },
          };
          await updateDiagnosisSteps("error");
        });
      };
    },
  };
}
