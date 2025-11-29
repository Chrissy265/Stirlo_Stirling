#!/usr/bin/env npx tsx
/**
 * Daily Task Trigger
 * 
 * Replit Scheduled Deployment Configuration:
 * - Schedule: "Every day at 8 AM"
 * - Cron: 0 8 * * *
 * - Timezone: Australia/Sydney
 * - Run command: npm run trigger:daily
 * - Timeout: 30 minutes
 * 
 * This script:
 * 1. Extracts tasks due today and overdue tasks from Monday.com
 * 2. Sends a team summary to #stirlo-assistant channel
 * 3. Sends individual DMs to assignees (one per person per day)
 * 4. Sends error notifications to #error-stirlo channel on failure
 */

import { config } from 'dotenv';
config();

import { WebClient } from '@slack/web-api';
import { initializeMonitoringServices } from '../src/services/index.js';
import { SlackNotifier } from '../src/triggers/slackTriggers.js';
import { formatDailySummary } from '../src/slack/messages/dailySummary.js';
import { formatPersonalDailySummary } from '../src/slack/messages/personalWeekly.js';
import { getAustralianDate, formatAustralianDate } from '../src/utils/dateUtils.js';
import { TaskAlert } from '../src/types/monitoring.js';

const TEAM_CHANNEL_ID = process.env.TEAM_CHANNEL_ID;
const ERROR_CHANNEL_ID = process.env.ERROR_CHANNEL_ID;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

async function main() {
  console.log('='.repeat(60));
  console.log('🌅 DAILY TASK TRIGGER');
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

    console.log('\n📋 Extracting tasks due today...');
    const dailyAlerts = await taskMonitor.processDailyTasks();
    console.log(`   Found ${dailyAlerts.length} tasks (due today + overdue)`);

    const overdueCount = dailyAlerts.filter(a => a.alertType === 'overdue').length;
    const todayCount = dailyAlerts.filter(a => a.alertType === 'due_today').length;
    console.log(`   📅 Due today: ${todayCount}`);
    console.log(`   🚨 Overdue: ${overdueCount}`);

    if (dailyAlerts.length === 0) {
      console.log('\n✅ No tasks due today and nothing overdue!');
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
      console.log('✅ Sent all-clear message to team channel');
    } else {
      console.log('\n📤 Sending daily summary to team channel...');
      const summaryMessage = formatDailySummary(dailyAlerts, getAustralianDate());
      await slackNotifier.sendToChannel(TEAM_CHANNEL_ID, summaryMessage);
      console.log('✅ Team summary sent');

      console.log('\n📤 Sending individual DMs to assignees...');
      const sentToUsers = await sendPersonalDMs(slackNotifier, taskMonitor, dailyAlerts);
      console.log(`✅ Sent DMs to ${sentToUsers} team members`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ DAILY TRIGGER COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ DAILY TRIGGER FAILED:', error);

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
                text: `_${formatAustralianDate(getAustralianDate())}_ | Please check the deployment logs.`
              }]
            }
          ],
          text: 'Daily task trigger failed - please check logs'
        });
        console.log('📤 Error notification sent to Slack');
      }
    } catch (notifyError) {
      console.error('Failed to send error notification:', notifyError);
    }

    process.exit(1);
  }
}

async function sendPersonalDMs(
  slackNotifier: SlackNotifier,
  taskMonitor: any,
  alerts: TaskAlert[]
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

    console.log(`   → Sending DM to ${slackId} (${userAlerts.length} task(s))`);

    const personalMessage = formatPersonalDailySummary(userAlerts, getAustralianDate(), slackId);
    const result = await slackNotifier.sendDirectMessage(slackId, personalMessage);

    if (result.ok) {
      dmCount++;
      
      for (const alert of userAlerts) {
        if (alert.id) {
          await taskMonitor.markAlertSent(alert.id);
        }
      }
    } else {
      console.log(`   ⚠️ Failed to send DM to ${slackId}: ${result.error}`);
    }

    await sleep(500);
  }

  return dmCount;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
