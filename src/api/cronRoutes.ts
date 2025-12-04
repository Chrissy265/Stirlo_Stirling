import type { Context } from "hono";
import type { ApiRoute } from "@mastra/core/server";
import { WebClient } from "@slack/web-api";
import { initializeMonitoringServices } from "../services/index.js";
import { SlackNotifier } from "../triggers/slackTriggers.js";
import { formatDailySummary } from "../slack/messages/dailySummary.js";
import { formatWeeklySummary } from "../slack/messages/weeklySummary.js";
import { formatPersonalDailySummary, formatPersonalWeeklySummary } from "../slack/messages/personalWeekly.js";
import { getAustralianDate, formatAustralianDate, getStartOfWeek } from "../utils/dateUtils.js";
import { TaskAlert } from "../types/monitoring.js";

const TEAM_CHANNEL_ID = process.env.TEAM_CHANNEL_ID;
const ERROR_CHANNEL_ID = process.env.ERROR_CHANNEL_ID;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

const EXTRACTION_MAX_RETRIES = 3;
const EXTRACTION_INITIAL_DELAY_MS = 2000;
const EXTRACTION_BACKOFF_MULTIPLIER = 2;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function verifyCronSecret(c: Context<any>, logger: any): boolean {
  if (!CRON_SECRET) {
    logger?.warn("⚠️ [Cron Auth] CRON_SECRET not configured - allowing request (insecure)");
    return true;
  }
  
  const authHeader = c.req.header("Authorization");
  const querySecret = c.req.query("secret");
  const providedSecret = authHeader?.replace("Bearer ", "") || querySecret;
  
  if (providedSecret !== CRON_SECRET) {
    logger?.warn("❌ [Cron Auth] Invalid or missing secret");
    return false;
  }
  
  return true;
}

async function extractTasksWithRetry(
  taskMonitor: any,
  type: 'daily' | 'weekly',
  logger: any,
  maxRetries: number = EXTRACTION_MAX_RETRIES
): Promise<{ alerts: TaskAlert[]; retriesUsed: number }> {
  let lastResult: TaskAlert[] = [];
  let delay = EXTRACTION_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      logger?.info(`📋 [Cron ${type}] Extracting tasks (attempt ${attempt}/${maxRetries + 1})...`);
      const alerts = type === 'daily' 
        ? await taskMonitor.processDailyTasks()
        : await taskMonitor.processWeeklyTasks();
      lastResult = alerts;
      
      if (alerts.length > 0) {
        if (attempt > 1) {
          logger?.info(`✅ [Cron ${type}] Successfully extracted ${alerts.length} tasks on attempt ${attempt}`);
        }
        return { alerts, retriesUsed: attempt - 1 };
      }
      
      if (attempt <= maxRetries) {
        logger?.warn(`⚠️ [Cron ${type}] Got 0 tasks on attempt ${attempt}. This may be a transient API issue.`);
        logger?.info(`🔄 [Cron ${type}] Retrying in ${delay}ms to verify...`);
        await sleep(delay);
        delay = delay * EXTRACTION_BACKOFF_MULTIPLIER;
      }
    } catch (error: any) {
      logger?.error(`❌ [Cron ${type}] Extraction failed on attempt ${attempt}: ${error.message}`);
      
      if (attempt <= maxRetries) {
        logger?.info(`🔄 [Cron ${type}] Retrying in ${delay}ms...`);
        await sleep(delay);
        delay = delay * EXTRACTION_BACKOFF_MULTIPLIER;
      } else {
        throw error;
      }
    }
  }

  logger?.info(`ℹ️ [Cron ${type}] Confirmed 0 tasks after ${maxRetries + 1} attempts - this appears to be accurate.`);
  return { alerts: lastResult, retriesUsed: maxRetries };
}

async function sendPersonalDMs(
  slackNotifier: SlackNotifier,
  taskMonitor: any,
  alerts: TaskAlert[],
  type: 'daily' | 'weekly',
  weekStart: Date | null,
  logger: any
): Promise<number> {
  const byAssignee: Record<string, TaskAlert[]> = {};

  for (const alert of alerts) {
    if (alert.assigneeSlackId) {
      const key = alert.assigneeSlackId;
      if (!byAssignee[key]) byAssignee[key] = [];
      byAssignee[key].push(alert);
    }
  }

  let dmCount = 0;
  const assigneeIds = Object.keys(byAssignee);

  for (const slackId of assigneeIds) {
    const userAlerts = byAssignee[slackId];
    
    if (!slackId || slackId === 'undefined' || slackId === 'null') {
      logger?.info(`⚠️ [Cron ${type}] Skipping ${userAlerts.length} task(s) with invalid Slack ID`);
      continue;
    }

    logger?.info(`📤 [Cron ${type}] Sending DM to ${slackId} (${userAlerts.length} task(s))`);

    const personalMessage = type === 'daily'
      ? formatPersonalDailySummary(userAlerts, getAustralianDate(), slackId)
      : formatPersonalWeeklySummary(userAlerts, weekStart!, slackId);
    
    const result = await slackNotifier.sendDirectMessage(slackId, personalMessage);

    if (result.ok) {
      dmCount++;
      
      if (type === 'daily') {
        for (const alert of userAlerts) {
          if (alert.id) {
            await taskMonitor.markAlertSent(alert.id);
          }
        }
      }
    } else {
      logger?.warn(`⚠️ [Cron ${type}] Failed to send DM to ${slackId}: ${result.error}`);
    }

    await sleep(500);
  }

  return dmCount;
}

/**
 * Background processor for daily tasks
 * Runs asynchronously after immediate response
 */
async function processDailyInBackground(logger: any): Promise<void> {
  const startTime = Date.now();
  
  logger?.info("🔧 [Cron Daily BG] Starting background processing...");

  if (!SLACK_BOT_TOKEN || !TEAM_CHANNEL_ID) {
    logger?.error("❌ [Cron Daily BG] Missing required config");
    return;
  }

  const slackClient = new WebClient(SLACK_BOT_TOKEN);
  const slackNotifier = new SlackNotifier(slackClient);

  try {
    logger?.info("🔧 [Cron Daily BG] Initializing monitoring services...");
    const { taskMonitor } = await initializeMonitoringServices();
    logger?.info("✅ [Cron Daily BG] Services initialized");

    const { alerts: dailyAlerts, retriesUsed } = await extractTasksWithRetry(
      taskMonitor,
      'daily',
      logger
    );
    
    if (retriesUsed > 0) {
      logger?.info(`ℹ️ [Cron Daily BG] Task extraction required ${retriesUsed} retry(ies)`);
    }
    
    const overdueCount = dailyAlerts.filter(a => a.alertType === 'overdue').length;
    const todayCount = dailyAlerts.filter(a => a.alertType === 'due_today').length;
    
    logger?.info(`📊 [Cron Daily BG] Found ${dailyAlerts.length} tasks (Due today: ${todayCount}, Overdue: ${overdueCount})`);

    if (dailyAlerts.length === 0) {
      logger?.info("✅ [Cron Daily BG] No tasks due today and nothing overdue!");
      await slackNotifier.sendToChannel(TEAM_CHANNEL_ID, {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '☀️ Good Morning Team!', emoji: true }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `No tasks are due today and nothing is overdue. Great job staying on top of things! 🎉`
            }
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `_${formatAustralianDate(getAustralianDate())}_`
            }]
          }
        ],
        text: 'Good morning! No tasks due today.'
      });
      logger?.info("✅ [Cron Daily BG] Sent all-clear message to team channel");
    } else {
      logger?.info("📤 [Cron Daily BG] Sending daily summary to team channel...");
      const summaryMessage = formatDailySummary(dailyAlerts, getAustralianDate());
      await slackNotifier.sendToChannel(TEAM_CHANNEL_ID, summaryMessage);
      logger?.info("✅ [Cron Daily BG] Team summary sent");

      logger?.info("📤 [Cron Daily BG] Sending individual DMs to assignees...");
      const sentToUsers = await sendPersonalDMs(
        slackNotifier,
        taskMonitor,
        dailyAlerts,
        'daily',
        null,
        logger
      );
      logger?.info(`✅ [Cron Daily BG] Sent DMs to ${sentToUsers} team members`);
    }

    const duration = Date.now() - startTime;
    logger?.info("=".repeat(60));
    logger?.info(`✅ [Cron Daily BG] COMPLETED SUCCESSFULLY in ${duration}ms`);
    logger?.info("=".repeat(60));
  } catch (error) {
    const duration = Date.now() - startTime;
    logger?.error("❌ [Cron Daily BG] TRIGGER FAILED:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: duration,
    });

    try {
      const errorChannel = ERROR_CHANNEL_ID || TEAM_CHANNEL_ID;
      if (errorChannel) {
        await slackNotifier.sendToChannel(errorChannel, {
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '⚠️ Daily Task Trigger Failed', emoji: true }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `\`\`\`${error instanceof Error ? error.message : String(error)}\`\`\``
              }
            },
            {
              type: 'context',
              elements: [{
                type: 'mrkdwn',
                text: `_${formatAustralianDate(getAustralianDate())}_ | Triggered via HTTP endpoint`
              }]
            }
          ],
          text: 'Daily task trigger failed - please check logs'
        });
        logger?.info("📤 [Cron Daily BG] Error notification sent to Slack");
      }
    } catch (notifyError) {
      logger?.error("❌ [Cron Daily BG] Failed to send error notification:", notifyError);
    }
  }
}

/**
 * POST /api/cron/daily - Trigger daily task summary
 * Called by Render Cron Jobs at 8 AM AEST
 * Requires CRON_SECRET for authentication
 * Returns immediately and processes in background
 */
export function getDailyCronRoute(): ApiRoute {
  return {
    path: "/api/cron/daily",
    method: "POST",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger();
      
      return async (c: Context<any>) => {
        logger?.info("=".repeat(60));
        logger?.info("🌅 [Cron Daily] DAILY TASK TRIGGER via HTTP");
        logger?.info(`UTC Time: ${new Date().toISOString()}`);
        logger?.info(`Australian Time: ${formatAustralianDate(getAustralianDate())}`);
        logger?.info("=".repeat(60));

        if (!verifyCronSecret(c, logger)) {
          return c.json({ error: "Unauthorized" }, 401);
        }

        if (!SLACK_BOT_TOKEN) {
          logger?.error("❌ [Cron Daily] SLACK_BOT_TOKEN is not set");
          return c.json({ error: "SLACK_BOT_TOKEN not configured" }, 500);
        }

        if (!TEAM_CHANNEL_ID) {
          logger?.error("❌ [Cron Daily] TEAM_CHANNEL_ID is not set");
          return c.json({ error: "TEAM_CHANNEL_ID not configured" }, 500);
        }

        // Start background processing (fire-and-forget)
        logger?.info("🚀 [Cron Daily] Starting background processing...");
        setImmediate(() => {
          processDailyInBackground(logger).catch(err => {
            logger?.error("❌ [Cron Daily] Background processing error:", err);
          });
        });

        // Return immediately (within 30 seconds)
        return c.json({
          success: true,
          message: "Daily trigger accepted - processing in background",
          note: "Check #stirlo-assistant for the task summary in 1-2 minutes",
          timestamp: new Date().toISOString(),
        });
      };
    },
  };
}

/**
 * Background processor for weekly tasks
 * Runs asynchronously after immediate response
 */
async function processWeeklyInBackground(logger: any): Promise<void> {
  const startTime = Date.now();
  
  logger?.info("🔧 [Cron Weekly BG] Starting background processing...");

  if (!SLACK_BOT_TOKEN || !TEAM_CHANNEL_ID) {
    logger?.error("❌ [Cron Weekly BG] Missing required config");
    return;
  }

  const slackClient = new WebClient(SLACK_BOT_TOKEN);
  const slackNotifier = new SlackNotifier(slackClient);

  try {
    logger?.info("🔧 [Cron Weekly BG] Initializing monitoring services...");
    const { taskMonitor } = await initializeMonitoringServices();
    logger?.info("✅ [Cron Weekly BG] Services initialized");

    const { alerts: weeklyAlerts, retriesUsed } = await extractTasksWithRetry(
      taskMonitor,
      'weekly',
      logger
    );
    
    if (retriesUsed > 0) {
      logger?.info(`ℹ️ [Cron Weekly BG] Task extraction required ${retriesUsed} retry(ies)`);
    }
    
    logger?.info(`📊 [Cron Weekly BG] Found ${weeklyAlerts.length} tasks due this week`);

    const weekStart = getStartOfWeek(getAustralianDate());

    if (weeklyAlerts.length === 0) {
      logger?.info("✅ [Cron Weekly BG] No tasks scheduled for this week!");
      await slackNotifier.sendToChannel(TEAM_CHANNEL_ID, {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '☀️ Happy Monday Team!', emoji: true }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Looks like a light week ahead - no tasks currently scheduled. Time to get ahead on upcoming projects! 🚀`
            }
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `_Week of ${formatAustralianDate(weekStart)}_`
            }]
          }
        ],
        text: 'Happy Monday! Light week ahead with no scheduled tasks.'
      });
      logger?.info("✅ [Cron Weekly BG] Sent light week message to team channel");
    } else {
      logger?.info("📤 [Cron Weekly BG] Sending weekly summary to team channel...");
      const teamSummary = formatWeeklySummary(weeklyAlerts, weekStart);
      await slackNotifier.sendToChannel(TEAM_CHANNEL_ID, teamSummary);
      logger?.info("✅ [Cron Weekly BG] Team weekly summary sent");

      logger?.info("📤 [Cron Weekly BG] Sending personal weekly outlooks...");
      const sentToUsers = await sendPersonalDMs(
        slackNotifier,
        null,
        weeklyAlerts,
        'weekly',
        weekStart,
        logger
      );
      logger?.info(`✅ [Cron Weekly BG] Sent weekly outlooks to ${sentToUsers} team members`);
    }

    const duration = Date.now() - startTime;
    logger?.info("=".repeat(60));
    logger?.info(`✅ [Cron Weekly BG] COMPLETED SUCCESSFULLY in ${duration}ms`);
    logger?.info("=".repeat(60));
  } catch (error) {
    const duration = Date.now() - startTime;
    logger?.error("❌ [Cron Weekly BG] TRIGGER FAILED:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: duration,
    });

    try {
      const errorChannel = ERROR_CHANNEL_ID || TEAM_CHANNEL_ID;
      if (errorChannel) {
        await slackNotifier.sendToChannel(errorChannel, {
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '⚠️ Weekly Task Trigger Failed', emoji: true }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `\`\`\`${error instanceof Error ? error.message : String(error)}\`\`\``
              }
            },
            {
              type: 'context',
              elements: [{
                type: 'mrkdwn',
                text: `_${formatAustralianDate(getAustralianDate())}_ | Triggered via HTTP endpoint`
              }]
            }
          ],
          text: 'Weekly task trigger failed - please check logs'
        });
        logger?.info("📤 [Cron Weekly BG] Error notification sent to Slack");
      }
    } catch (notifyError) {
      logger?.error("❌ [Cron Weekly BG] Failed to send error notification:", notifyError);
    }
  }
}

/**
 * POST /api/cron/weekly - Trigger weekly task summary
 * Called by Render Cron Jobs every Monday at 8 AM AEST
 * Requires CRON_SECRET for authentication
 * Returns immediately and processes in background
 */
export function getWeeklyCronRoute(): ApiRoute {
  return {
    path: "/api/cron/weekly",
    method: "POST",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger();
      
      return async (c: Context<any>) => {
        logger?.info("=".repeat(60));
        logger?.info("📅 [Cron Weekly] WEEKLY TASK TRIGGER via HTTP (Monday Morning)");
        logger?.info(`UTC Time: ${new Date().toISOString()}`);
        logger?.info(`Australian Time: ${formatAustralianDate(getAustralianDate())}`);
        logger?.info("=".repeat(60));

        if (!verifyCronSecret(c, logger)) {
          return c.json({ error: "Unauthorized" }, 401);
        }

        if (!SLACK_BOT_TOKEN) {
          logger?.error("❌ [Cron Weekly] SLACK_BOT_TOKEN is not set");
          return c.json({ error: "SLACK_BOT_TOKEN not configured" }, 500);
        }

        if (!TEAM_CHANNEL_ID) {
          logger?.error("❌ [Cron Weekly] TEAM_CHANNEL_ID is not set");
          return c.json({ error: "TEAM_CHANNEL_ID not configured" }, 500);
        }

        // Start background processing (fire-and-forget)
        logger?.info("🚀 [Cron Weekly] Starting background processing...");
        setImmediate(() => {
          processWeeklyInBackground(logger).catch(err => {
            logger?.error("❌ [Cron Weekly] Background processing error:", err);
          });
        });

        // Return immediately (within 30 seconds)
        return c.json({
          success: true,
          message: "Weekly trigger accepted - processing in background",
          note: "Check #stirlo-assistant for the weekly summary in 1-2 minutes",
          timestamp: new Date().toISOString(),
        });
      };
    },
  };
}

/**
 * GET /api/cron/status - Check cron configuration status
 * Returns information about cron endpoints without triggering them
 */
export function getCronStatusRoute(): ApiRoute {
  return {
    path: "/api/cron/status",
    method: "GET",
    createHandler: async ({ mastra }) => {
      const logger = mastra.getLogger();
      
      return async (c: Context<any>) => {
        logger?.debug("📊 [Cron Status] Status check requested");

        const australianNow = getAustralianDate();
        const weekStart = getStartOfWeek(australianNow);

        return c.json({
          status: "configured",
          currentTime: {
            utc: new Date().toISOString(),
            australian: formatAustralianDate(australianNow),
            weekStart: formatAustralianDate(weekStart),
          },
          endpoints: {
            daily: {
              path: "/api/cron/daily",
              method: "POST",
              schedule: "8 AM AEST daily",
              renderCron: "0 21 * * *",
              description: "Sends daily task summary and personal DMs",
            },
            weekly: {
              path: "/api/cron/weekly",
              method: "POST",
              schedule: "8 AM AEST every Monday",
              renderCron: "0 21 * * 0",
              description: "Sends weekly overview and personal weekly outlooks",
            },
          },
          configuration: {
            teamChannel: TEAM_CHANNEL_ID ? "configured" : "missing",
            errorChannel: ERROR_CHANNEL_ID ? "configured" : "missing",
            slackBot: SLACK_BOT_TOKEN ? "configured" : "missing",
            cronSecret: CRON_SECRET ? "configured" : "not set (insecure)",
          },
          usage: {
            note: "Add Authorization: Bearer YOUR_CRON_SECRET header or ?secret=YOUR_CRON_SECRET query param",
            example: "curl -X POST https://your-app.onrender.com/api/cron/daily -H 'Authorization: Bearer YOUR_SECRET'",
          },
        });
      };
    },
  };
}
