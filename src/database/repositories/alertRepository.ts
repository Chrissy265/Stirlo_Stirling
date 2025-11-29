import { eq, isNull, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { taskAlerts, taskSnoozes } from '../../db/schema.js';
import type { TaskAlert, DocumentLink } from '../../types/monitoring.js';

interface SnoozeInput {
  alertId: string;
  taskId: string;
  userId: string;
  snoozeUntil: Date;
  duration: string;
}

export class AlertRepository {
  async createMany(alerts: TaskAlert[]): Promise<void> {
    if (alerts.length === 0) return;

    const values = alerts.map(alert => ({
      id: alert.id,
      taskId: alert.taskId,
      taskName: alert.taskName,
      taskUrl: alert.taskUrl,
      boardId: alert.boardId,
      boardName: alert.boardName,
      workspaceName: alert.workspaceName,
      groupName: alert.groupName,
      assignee: alert.assignee,
      assigneeSlackId: alert.assigneeSlackId,
      dueDate: alert.dueDate,
      status: alert.status,
      statusColor: alert.statusColor,
      alertType: alert.alertType,
      relatedDocuments: alert.relatedDocuments as any,
      contextualMessage: alert.contextualMessage,
      priority: alert.priority,
      sentAt: alert.sentAt,
      createdAt: alert.createdAt,
    }));

    await db.insert(taskAlerts).values(values).onConflictDoNothing();
  }

  async create(alert: TaskAlert): Promise<void> {
    await this.createMany([alert]);
  }

  async getPending(): Promise<TaskAlert[]> {
    const results = await db
      .select()
      .from(taskAlerts)
      .where(isNull(taskAlerts.sentAt));

    return results.map(this.mapToTaskAlert);
  }

  async markSent(alertId: string): Promise<void> {
    await db
      .update(taskAlerts)
      .set({ sentAt: new Date() })
      .where(eq(taskAlerts.id, alertId));
  }

  async markManySent(alertIds: string[]): Promise<void> {
    if (alertIds.length === 0) return;

    await db
      .update(taskAlerts)
      .set({ sentAt: new Date() })
      .where(sql`${taskAlerts.id} = ANY(${alertIds})`);
  }

  async getByDateRange(start: Date, end: Date): Promise<TaskAlert[]> {
    const results = await db
      .select()
      .from(taskAlerts)
      .where(
        and(
          gte(taskAlerts.dueDate, start),
          lte(taskAlerts.dueDate, end)
        )
      );

    return results.map(this.mapToTaskAlert);
  }

  async getByAssignee(slackUserId: string): Promise<TaskAlert[]> {
    const results = await db
      .select()
      .from(taskAlerts)
      .where(eq(taskAlerts.assigneeSlackId, slackUserId));

    return results.map(this.mapToTaskAlert);
  }

  async getByAlertType(alertType: TaskAlert['alertType']): Promise<TaskAlert[]> {
    const results = await db
      .select()
      .from(taskAlerts)
      .where(eq(taskAlerts.alertType, alertType));

    return results.map(this.mapToTaskAlert);
  }

  async deleteOld(beforeDate: Date): Promise<number> {
    const result = await db
      .delete(taskAlerts)
      .where(lte(taskAlerts.createdAt, beforeDate));

    return result.rowCount || 0;
  }

  async createSnooze(input: SnoozeInput): Promise<void> {
    await db.insert(taskSnoozes).values({
      alertId: input.alertId,
      taskId: input.taskId,
      userId: input.userId,
      snoozeUntil: input.snoozeUntil,
      duration: input.duration,
      processed: false,
    });
    console.log(`✅ [AlertRepository] Snooze created for alert ${input.alertId} until ${input.snoozeUntil.toISOString()}`);
  }

  async getSnoozesToProcess(): Promise<Array<{ alertId: string; taskId: string; userId: string }>> {
    const now = new Date();
    const results = await db
      .select({
        alertId: taskSnoozes.alertId,
        taskId: taskSnoozes.taskId,
        userId: taskSnoozes.userId,
      })
      .from(taskSnoozes)
      .where(
        and(
          lte(taskSnoozes.snoozeUntil, now),
          eq(taskSnoozes.processed, false)
        )
      );
    return results;
  }

  async markSnoozeProcessed(alertId: string): Promise<void> {
    await db
      .update(taskSnoozes)
      .set({ processed: true })
      .where(eq(taskSnoozes.alertId, alertId));
  }

  private mapToTaskAlert(row: typeof taskAlerts.$inferSelect): TaskAlert {
    return {
      id: row.id,
      taskId: row.taskId,
      taskName: row.taskName,
      taskUrl: row.taskUrl,
      boardId: row.boardId,
      boardName: row.boardName,
      workspaceName: row.workspaceName,
      groupName: row.groupName,
      assignee: row.assignee,
      assigneeSlackId: row.assigneeSlackId,
      dueDate: row.dueDate,
      status: row.status,
      statusColor: row.statusColor,
      alertType: row.alertType as TaskAlert['alertType'],
      relatedDocuments: (row.relatedDocuments || []) as DocumentLink[],
      contextualMessage: row.contextualMessage,
      priority: (row.priority || 'medium') as TaskAlert['priority'],
      sentAt: row.sentAt,
      createdAt: row.createdAt || new Date(),
    };
  }
}

export const alertRepository = new AlertRepository();
