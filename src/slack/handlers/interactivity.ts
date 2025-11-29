import { WebClient } from '@slack/web-api';
import { SlackInteractionPayload, SlackModalView, SlackMessage } from '../types';
import { MondayClient } from '../../monday/client';

interface InteractivityContext {
  slackClient: WebClient;
  mondayClient: MondayClient;
}

export async function handleInteraction(
  payload: SlackInteractionPayload,
  context: InteractivityContext
): Promise<void> {
  console.log(`🔄 [Interactivity] Received interaction: ${payload.type}`);

  try {
    if (payload.type === 'block_actions' && payload.actions) {
      for (const action of payload.actions) {
        await handleBlockAction(action, payload, context);
      }
    } else if (payload.type === 'view_submission' && payload.view) {
      await handleViewSubmission(payload, context);
    }
  } catch (error: any) {
    console.error(`❌ [Interactivity] Error handling interaction: ${error.message}`);
    throw error;
  }
}

async function handleBlockAction(
  action: { action_id: string; value?: string },
  payload: SlackInteractionPayload,
  context: InteractivityContext
): Promise<void> {
  console.log(`🔘 [Interactivity] Handling action: ${action.action_id}`);

  if (action.action_id === 'complete_task') {
    await handleCompleteTask(action, payload, context);
  } else if (action.action_id === 'snooze_task') {
    await handleSnoozeTask(action, payload, context);
  } else if (action.action_id.startsWith('view_task_') || action.action_id.startsWith('view_personal_task_')) {
    console.log(`📋 [Interactivity] View task button clicked - handled by URL`);
  }
}

async function handleCompleteTask(
  action: { action_id: string; value?: string },
  payload: SlackInteractionPayload,
  context: InteractivityContext
): Promise<void> {
  console.log(`✅ [Interactivity] Processing complete task action`);

  if (!action.value) {
    console.error('❌ [Interactivity] No value in complete_task action');
    return;
  }

  let taskData: { taskId: string; boardId: string | null };
  try {
    taskData = JSON.parse(action.value);
  } catch (e) {
    console.error('❌ [Interactivity] Failed to parse action value:', action.value);
    return;
  }

  const { taskId, boardId } = taskData;

  if (!taskId) {
    console.error('❌ [Interactivity] Missing taskId in action value');
    return;
  }

  try {
    console.log(`📝 [Interactivity] Updating task ${taskId} to complete status`);
    
    const statusColumnId = await findStatusColumn(taskId, boardId, context.mondayClient);
    
    if (statusColumnId) {
      await context.mondayClient.changeColumnValue(
        boardId!,
        taskId,
        statusColumnId,
        JSON.stringify({ label: 'Done' })
      );
      console.log(`✅ [Interactivity] Task ${taskId} marked as complete in Monday.com`);
    } else {
      console.warn(`⚠️ [Interactivity] Could not find status column for task ${taskId}`);
    }

    if (payload.response_url) {
      await sendResponseMessage(payload.response_url, {
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Task marked as complete by <@${payload.user.id}>`
          }
        }],
        text: 'Task marked as complete'
      });
    }
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to complete task: ${error.message}`);
    
    if (payload.response_url) {
      await sendResponseMessage(payload.response_url, {
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ Failed to mark task as complete: ${error.message}`
          }
        }],
        text: 'Failed to complete task'
      });
    }
  }
}

async function handleSnoozeTask(
  action: { action_id: string; value?: string },
  payload: SlackInteractionPayload,
  context: InteractivityContext
): Promise<void> {
  console.log(`⏰ [Interactivity] Processing snooze task action`);

  if (!action.value) {
    console.error('❌ [Interactivity] No value in snooze_task action');
    return;
  }

  let taskData: { alertId: string; taskId: string; taskName: string };
  try {
    taskData = JSON.parse(action.value);
  } catch (e) {
    console.error('❌ [Interactivity] Failed to parse action value:', action.value);
    return;
  }

  const modal: SlackModalView = {
    type: 'modal',
    callback_id: 'snooze_modal',
    title: { type: 'plain_text', text: 'Snooze Task' },
    submit: { type: 'plain_text', text: 'Snooze' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: action.value,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Task:* ${taskData.taskName}\n\nChoose when you'd like to be reminded again:`
        }
      },
      {
        type: 'input',
        block_id: 'snooze_duration',
        label: { type: 'plain_text', text: 'Snooze for' },
        element: {
          type: 'static_select',
          action_id: 'snooze_duration_select',
          placeholder: { type: 'plain_text', text: 'Select duration' },
          options: [
            { text: { type: 'plain_text', text: '1 hour' }, value: '1h' },
            { text: { type: 'plain_text', text: '4 hours' }, value: '4h' },
            { text: { type: 'plain_text', text: 'Tomorrow morning (9 AM)' }, value: 'tomorrow' },
            { text: { type: 'plain_text', text: 'Next week' }, value: 'next_week' }
          ]
        }
      }
    ]
  };

  try {
    await context.slackClient.views.open({
      trigger_id: payload.trigger_id,
      view: modal as any
    });
    console.log(`✅ [Interactivity] Snooze modal opened`);
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to open snooze modal: ${error.message}`);
  }
}

async function handleViewSubmission(
  payload: SlackInteractionPayload,
  context: InteractivityContext
): Promise<void> {
  if (!payload.view) return;

  const callbackId = payload.view.callback_id;
  console.log(`📝 [Interactivity] Processing view submission: ${callbackId}`);

  if (callbackId === 'snooze_modal') {
    await handleSnoozeSubmission(payload, context);
  }
}

async function handleSnoozeSubmission(
  payload: SlackInteractionPayload,
  context: InteractivityContext
): Promise<void> {
  if (!payload.view?.state?.values || !payload.view.private_metadata) {
    console.error('❌ [Interactivity] Missing view state or metadata');
    return;
  }

  const snoozeDuration = payload.view.state.values['snooze_duration']?.['snooze_duration_select']?.selected_option?.value;
  
  if (!snoozeDuration) {
    console.error('❌ [Interactivity] No snooze duration selected');
    return;
  }

  let taskData: { alertId: string; taskId: string; taskName: string };
  try {
    taskData = JSON.parse(payload.view.private_metadata);
  } catch (e) {
    console.error('❌ [Interactivity] Failed to parse private metadata');
    return;
  }

  const snoozeUntil = calculateSnoozeTime(snoozeDuration);
  
  console.log(`⏰ [Interactivity] Task ${taskData.taskId} snoozed until ${snoozeUntil.toISOString()}`);

  try {
    await context.slackClient.chat.postMessage({
      channel: payload.user.id,
      text: `⏰ Task "${taskData.taskName}" has been snoozed. I'll remind you again ${formatSnoozeMessage(snoozeDuration)}.`,
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⏰ *Task snoozed:* "${taskData.taskName}"\n\nI'll remind you again ${formatSnoozeMessage(snoozeDuration)}.`
        }
      }]
    });
    console.log(`✅ [Interactivity] Snooze confirmation sent`);
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to send snooze confirmation: ${error.message}`);
  }
}

function calculateSnoozeTime(duration: string): Date {
  const now = new Date();
  
  switch (duration) {
    case '1h':
      return new Date(now.getTime() + 60 * 60 * 1000);
    case '4h':
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case 'tomorrow': {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    }
    case 'next_week': {
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(9, 0, 0, 0);
      return nextWeek;
    }
    default:
      return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

function formatSnoozeMessage(duration: string): string {
  switch (duration) {
    case '1h': return 'in 1 hour';
    case '4h': return 'in 4 hours';
    case 'tomorrow': return 'tomorrow at 9 AM';
    case 'next_week': return 'next week';
    default: return 'soon';
  }
}

async function findStatusColumn(
  taskId: string,
  boardId: string | null,
  mondayClient: MondayClient
): Promise<string | null> {
  if (!boardId) {
    console.warn('⚠️ [Interactivity] No boardId provided, cannot find status column');
    return null;
  }

  try {
    const boardInfo = await mondayClient.getBoardById(boardId);
    
    if (boardInfo?.columns) {
      const statusColumn = boardInfo.columns.find(
        (col: any) => col.type === 'status' || col.id === 'status'
      );
      return statusColumn?.id || null;
    }
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to get board info: ${error.message}`);
  }

  return null;
}

async function sendResponseMessage(responseUrl: string, message: SlackMessage): Promise<void> {
  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: false,
        response_type: 'ephemeral',
        ...message
      })
    });

    if (!response.ok) {
      console.error(`❌ [Interactivity] Response message failed: ${response.status}`);
    }
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to send response message: ${error.message}`);
  }
}
