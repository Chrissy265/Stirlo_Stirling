import { WebClient } from '@slack/web-api';
import { SlackInteractionPayload, SlackModalView, SlackMessage } from '../types';
import { MondayClient } from '../../monday/client';
import { AlertRepository } from '../../database/repositories/alertRepository';

interface InteractivityContext {
  slackClient: WebClient;
  mondayClient: MondayClient;
  alertRepository?: AlertRepository;
}

interface CompleteTaskPayload {
  taskId: string;
  boardId: string | null;
  taskName?: string;
}

interface SnoozeTaskPayload {
  alertId: string;
  taskId: string;
  taskName: string;
  boardId?: string | null;
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
    await sendErrorResponse(payload.response_url, 'No task data provided');
    return;
  }

  let taskData: CompleteTaskPayload;
  try {
    taskData = JSON.parse(action.value);
  } catch (e) {
    console.error('❌ [Interactivity] Failed to parse action value:', action.value);
    await sendErrorResponse(payload.response_url, 'Invalid task data');
    return;
  }

  const { taskId, boardId, taskName } = taskData;

  if (!taskId) {
    await sendErrorResponse(payload.response_url, 'Missing task ID');
    return;
  }

  if (!boardId) {
    await sendErrorResponse(payload.response_url, 'Cannot update task: missing board information');
    return;
  }

  try {
    console.log(`📝 [Interactivity] Updating task ${taskId} on board ${boardId}`);
    
    const { statusColumnId, statusValue } = await findStatusColumnAndValue(boardId, context.mondayClient);
    
    if (!statusColumnId) {
      console.warn(`⚠️ [Interactivity] No status column found for board ${boardId}`);
      await sendErrorResponse(
        payload.response_url, 
        'Could not find status column on this board. Please mark complete in Monday.com directly.'
      );
      return;
    }

    const success = await context.mondayClient.changeColumnValue(
      boardId,
      taskId,
      statusColumnId,
      statusValue
    );

    if (success) {
      console.log(`✅ [Interactivity] Task ${taskId} marked as complete in Monday.com`);
      await sendSuccessResponse(
        payload.response_url,
        `✅ Task "${taskName || taskId}" marked as complete by <@${payload.user.id}>`
      );
    } else {
      await sendErrorResponse(
        payload.response_url,
        'Failed to update task in Monday.com. Please try again or update directly.'
      );
    }
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to complete task: ${error.message}`);
    await sendErrorResponse(payload.response_url, `Error: ${error.message}`);
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

  let taskData: SnoozeTaskPayload;
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
    private_metadata: JSON.stringify({
      ...taskData,
      userId: payload.user.id
    }),
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

  let taskData: SnoozeTaskPayload & { userId?: string };
  try {
    taskData = JSON.parse(payload.view.private_metadata);
  } catch (e) {
    console.error('❌ [Interactivity] Failed to parse private metadata');
    return;
  }

  const snoozeUntil = calculateSnoozeTime(snoozeDuration);
  const userId = taskData.userId || payload.user.id;
  
  console.log(`⏰ [Interactivity] Task ${taskData.taskId} snoozed until ${snoozeUntil.toISOString()}`);

  try {
    if (context.alertRepository && taskData.alertId) {
      await context.alertRepository.createSnooze({
        alertId: taskData.alertId,
        taskId: taskData.taskId,
        userId: userId,
        snoozeUntil: snoozeUntil,
        duration: snoozeDuration
      });
      console.log(`✅ [Interactivity] Snooze persisted for alert ${taskData.alertId}`);
    } else {
      console.log(`⚠️ [Interactivity] No alert repository available, snooze not persisted`);
    }

    await context.slackClient.chat.postMessage({
      channel: userId,
      text: `⏰ Task "${taskData.taskName}" has been snoozed. I'll remind you again ${formatSnoozeMessage(snoozeDuration)}.`,
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⏰ *Task snoozed:* "${taskData.taskName}"\n\nI'll remind you again ${formatSnoozeMessage(snoozeDuration)}.`
        }
      }]
    });
    console.log(`✅ [Interactivity] Snooze confirmation sent to user ${userId}`);
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to process snooze: ${error.message}`);
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

async function findStatusColumnAndValue(
  boardId: string,
  mondayClient: MondayClient
): Promise<{ statusColumnId: string | null; statusValue: string }> {
  try {
    const boardInfo = await mondayClient.getBoardById(boardId);
    
    if (!boardInfo?.columns) {
      console.warn(`⚠️ [Interactivity] No columns found for board ${boardId}`);
      return { statusColumnId: null, statusValue: '' };
    }

    const statusColumn = boardInfo.columns.find(
      (col: any) => col.type === 'status'
    );

    if (!statusColumn) {
      const statusById = boardInfo.columns.find((col: any) => col.id === 'status');
      if (statusById) {
        return { 
          statusColumnId: statusById.id, 
          statusValue: JSON.stringify({ label: 'Done' })
        };
      }
      return { statusColumnId: null, statusValue: '' };
    }

    return { 
      statusColumnId: statusColumn.id, 
      statusValue: JSON.stringify({ label: 'Done' })
    };
  } catch (error: any) {
    console.error(`❌ [Interactivity] Failed to get board info: ${error.message}`);
    return { statusColumnId: null, statusValue: '' };
  }
}

async function sendSuccessResponse(responseUrl: string | undefined, message: string): Promise<void> {
  if (!responseUrl) return;
  await sendResponseMessage(responseUrl, {
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: message }
    }],
    text: message
  });
}

async function sendErrorResponse(responseUrl: string | undefined, error: string): Promise<void> {
  if (!responseUrl) {
    console.error(`❌ [Interactivity] Error (no response URL): ${error}`);
    return;
  }
  await sendResponseMessage(responseUrl, {
    blocks: [{
      type: 'section',
      text: { type: 'mrkdwn', text: `❌ ${error}` }
    }],
    text: `Error: ${error}`
  });
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
