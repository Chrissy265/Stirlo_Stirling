#!/usr/bin/env npx tsx
/**
 * Weekly Task Trigger
 * 
 * Replit Scheduled Deployment Configuration:
 * - Schedule: "Every Monday at 8 AM"
 * - Cron: 0 8 * * 1
 * - Timezone: Australia/Sydney
 * - Run command: npm run trigger:weekly
 * - Timeout: 60 minutes
 * 
 * This script:
 * 1. Extracts tasks due this week from Monday.com
 * 2. Sends a team-wide weekly overview to #stirlo-assistant channel
 * 3. Sends personal weekly outlook DMs to each team member
 * 4. Sends error notifications to #error-stirlo channel on failure
 */

import { config } from 'dotenv';
config();

import { WebClient } from '@slack/web-api';
import { initializeMonitoringServices } from '../src/services/index.js';
import { SlackNotifier } from '../src/triggers/slackTriggers.js';
import { formatWeeklySummary } from '../src/slack/messages/weeklySummary.js';
import { formatPersonalWeeklySummary } from '../src/slack/messages/personalWeekly.js';
import { getAustralianDate, formatAustralianDate, getStartOfWeek } from '../src/utils/dateUtils.js';
import { TaskAlert } from '../src/types/monitoring.js';

const TEAM_CHANNEL_ID = process.env.TEAM_CHANNEL_ID;
const ERROR_CHANNEL_ID = process.env.ERROR_CHANNEL_ID;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

async function main() {
  console.log('='.repeat(60));
  console.log('📅 WEEKLY TASK TRIGGER (Monday Morning)');
  console.log(`UTC Time: ${new Date().toISOString()}`);
  console.log(`Australian Time: ${formatAustralianDate(getAustralianDate())}`);
  console.log('='.repeat(60));

  if (!SLACK_BOT_TOKEN) {
    console.error('❌ SLACK_BOT_TOKEN is not set');
    process.exit(1);
  }

  if (!TEAM_CHANNEL_ID) {
    console.error('❌ TEAM_CHANNEL_ID is not set');
    process.exit(1);
  }

  const slackClient = new WebClient(SLACK_BOT_TOKEN);
  const slackNotifier = new SlackNotifier(slackClient);

  try {
    console.log('\n🔧 Initializing monitoring services...');
    const { taskMonitor } = await initializeMonitoringServices();
    console.log('✅ Services initialized');

    console.log('\n📋 Extracting tasks for this week...');
    const weeklyAlerts = await taskMonitor.processWeeklyTasks();
    console.log(`   Found ${weeklyAlerts.length} tasks due this week`);

    const weekStart = getStartOfWeek(getAustralianDate());

    if (weeklyAlerts.length === 0) {
      console.log('\n✅ No tasks scheduled for this week!');
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
      console.log('✅ Sent light week message to team channel');
    } else {
      console.log('\n📤 Sending weekly summary to team channel...');
      const teamSummary = formatWeeklySummary(weeklyAlerts, weekStart);
      await slackNotifier.sendToChannel(TEAM_CHANNEL_ID, teamSummary);
      console.log('✅ Team weekly summary sent');

      console.log('\n📤 Sending personal weekly outlooks...');
      const sentToUsers = await sendPersonalWeeklyDMs(slackNotifier, weeklyAlerts, weekStart);
      console.log(`✅ Sent weekly outlooks to ${sentToUsers} team members`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ WEEKLY TRIGGER COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ WEEKLY TRIGGER FAILED:', error);

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
                text: `_${formatAustralianDate(getAustralianDate())}_ | Please check the deployment logs.`
              }]
            }
          ],
          text: 'Weekly task trigger failed - please check logs'
        });
        console.log('📤 Error notification sent to Slack');
      }
    } catch (notifyError) {
      console.error('Failed to send error notification:', notifyError);
    }

    process.exit(1);
  }
}

async function sendPersonalWeeklyDMs(
  slackNotifier: SlackNotifier,
  alerts: TaskAlert[],
  weekStart: Date
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
      console.log(`   ⚠️ Skipping ${userAlerts.length} task(s) with invalid Slack ID`);
      continue;
    }

    console.log(`   → Sending weekly outlook to ${slackId} (${userAlerts.length} task(s))`);

    const personalSummary = formatPersonalWeeklySummary(userAlerts, weekStart, slackId);
    const result = await slackNotifier.sendDirectMessage(slackId, personalSummary);

    if (result.ok) {
      dmCount++;
    } else {
      console.log(`   ⚠️ Failed to send weekly outlook to ${slackId}: ${result.error}`);
    }

    await sleep(500);
  }

  return dmCount;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
