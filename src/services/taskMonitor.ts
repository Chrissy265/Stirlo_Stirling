import { randomUUID } from 'crypto';
import type { Task, MondayUser } from '../monday/types.js';
import type { TaskAlert, DocumentLink } from '../types/monitoring.js';
import { MondayWorkspaceManager } from '../monday/workspaceManager.js';
import { AlertGenerator } from './alertGenerator.js';
import { DocumentExtractor } from './documentExtractor.js';
import { AlertRepository } from '../database/repositories/alertRepository.js';
import { UserMappingRepository } from '../database/repositories/userMappingRepository.js';
import { QueryLogRepository } from '../database/repositories/queryLogRepository.js';
import {
  getAustralianDate,
  getStartOfDay,
  getEndOfDay,
  getStartOfWeek,
  getEndOfWeek,
  getDaysUntilDue,
  isOverdue,
  formatAustralianDateOnly,
} from '../utils/dateUtils.js';

function generateAlertId(): string {
  return `alert-${randomUUID()}`;
}

export class TaskMonitor {
  constructor(
    private mondayManager: MondayWorkspaceManager,
    private alertGenerator: AlertGenerator,
    private documentExtractor: DocumentExtractor,
    private alertRepo: AlertRepository,
    private userMappingRepo: UserMappingRepository,
    private queryLogRepo: QueryLogRepository
  ) {
    console.log(`🔧 [TaskMonitor] Initialized`);
  }

  async processDailyTasks(): Promise<TaskAlert[]> {
    console.log(`📅 [TaskMonitor] Processing daily tasks...`);
    const now = getAustralianDate();
    const startOfDay = getStartOfDay(now);
    const endOfDay = getEndOfDay(now);

    const todayTasks = await this.mondayManager.getTasksDueInRange(startOfDay, endOfDay);
    console.log(`📋 [TaskMonitor] Found ${todayTasks.length} tasks due today`);

    const yesterdayStart = new Date(startOfDay.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yesterdayEnd = new Date(startOfDay.getTime() - 1);
    const overdueTasks = await this.mondayManager.getTasksDueInRange(yesterdayStart, yesterdayEnd);
    const actuallyOverdue = overdueTasks.filter(task => task.dueDate && isOverdue(task.dueDate));
    console.log(`⚠️ [TaskMonitor] Found ${actuallyOverdue.length} overdue tasks`);

    const allTasks = [...todayTasks, ...actuallyOverdue];

    const todayAlerts = await this.generateAlerts(todayTasks, 'due_today');
    const overdueAlerts = await this.generateAlerts(actuallyOverdue, 'overdue');

    const allAlerts = [...todayAlerts, ...overdueAlerts];
    console.log(`✅ [TaskMonitor] Generated ${allAlerts.length} total daily alerts`);

    return allAlerts;
  }

  async processWeeklyTasks(): Promise<TaskAlert[]> {
    console.log(`📅 [TaskMonitor] Processing weekly tasks...`);
    const now = getAustralianDate();
    const startOfWeek = getStartOfWeek(now);
    const endOfWeek = getEndOfWeek(now);

    const tasks = await this.mondayManager.getTasksDueInRange(startOfWeek, endOfWeek);
    console.log(`📋 [TaskMonitor] Found ${tasks.length} tasks due this week`);

    const alerts = await this.generateAlerts(tasks, 'due_this_week');
    console.log(`✅ [TaskMonitor] Generated ${alerts.length} weekly alerts`);

    return alerts;
  }

  async getTasksOnDemand(
    type: 'today' | 'week' | 'overdue',
    userId?: string
  ): Promise<TaskAlert[]> {
    console.log(`🔍 [TaskMonitor] On-demand task request: type=${type}, userId=${userId || 'all'}`);
    const now = getAustralianDate();
    
    let tasks: Task[] = [];
    let alertType: TaskAlert['alertType'];

    switch (type) {
      case 'today':
        const startOfDay = getStartOfDay(now);
        const endOfDay = getEndOfDay(now);
        tasks = await this.mondayManager.getTasksDueInRange(startOfDay, endOfDay);
        alertType = 'due_today';
        break;

      case 'week':
        const startOfWeek = getStartOfWeek(now);
        const endOfWeek = getEndOfWeek(now);
        tasks = await this.mondayManager.getTasksDueInRange(startOfWeek, endOfWeek);
        alertType = 'due_this_week';
        break;

      case 'overdue':
        const pastStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const yesterdayEnd = new Date(getStartOfDay(now).getTime() - 1);
        tasks = await this.mondayManager.getTasksDueInRange(pastStart, yesterdayEnd);
        tasks = tasks.filter(task => task.dueDate && isOverdue(task.dueDate));
        alertType = 'overdue';
        break;
    }

    if (userId) {
      const mondayUserId = await this.userMappingRepo.getMondayUserId(userId);
      if (mondayUserId) {
        tasks = tasks.filter(task => task.assigneeId === mondayUserId);
        console.log(`👤 [TaskMonitor] Filtered to ${tasks.length} tasks for user ${userId}`);
      } else {
        const slackUserName = await this.tryGetSlackUserName(userId);
        if (slackUserName) {
          tasks = tasks.filter(task => 
            task.assigneeName?.toLowerCase().includes(slackUserName.toLowerCase())
          );
          console.log(`👤 [TaskMonitor] Filtered by name match to ${tasks.length} tasks for ${slackUserName}`);
        }
      }
    }

    const alerts = await this.generateAlerts(tasks, alertType, false);
    console.log(`✅ [TaskMonitor] Generated ${alerts.length} on-demand alerts`);

    return alerts;
  }

  private async generateAlerts(
    tasks: Task[],
    alertType: TaskAlert['alertType'],
    persist: boolean = true
  ): Promise<TaskAlert[]> {
    const alerts: TaskAlert[] = [];
    const today = formatAustralianDateOnly(new Date());

    let existingTaskIds = new Set<string>();
    if (persist) {
      const existingAlerts = await this.alertRepo.getByDateRange(
        getStartOfDay(new Date()),
        getEndOfDay(new Date())
      );
      existingTaskIds = new Set(existingAlerts.map(a => a.taskId));
    }

    for (const task of tasks) {
      if (existingTaskIds.has(task.id)) {
        console.log(`⏭️ [TaskMonitor] Skipping duplicate alert for task ${task.id} (already has alert today)`);
        continue;
      }

      const contextualMessage = this.alertGenerator.generateContextualMessage(task, alertType);
      const relatedDocuments = await this.documentExtractor.extractRelatedDocuments(task);
      const priority = this.calculatePriority(task, alertType);

      let assigneeSlackId: string | null = null;
      if (task.assigneeId) {
        assigneeSlackId = await this.userMappingRepo.getSlackUserId(task.assigneeId);
      }

      const alert: TaskAlert = {
        id: generateAlertId(),
        taskId: task.id,
        taskName: task.name,
        taskUrl: task.url,
        boardId: task.boardId,
        boardName: task.boardName,
        workspaceName: task.workspaceName,
        groupName: task.groupName,
        assignee: task.assigneeName,
        assigneeSlackId,
        dueDate: task.dueDate!,
        status: task.status,
        statusColor: task.statusColor,
        alertType,
        relatedDocuments,
        contextualMessage,
        priority,
        sentAt: null,
        createdAt: new Date(),
      };

      alerts.push(alert);
    }

    if (persist && alerts.length > 0) {
      await this.alertRepo.createMany(alerts);
      console.log(`💾 [TaskMonitor] Persisted ${alerts.length} alerts`);
    }

    return alerts;
  }

  private calculatePriority(task: Task, alertType: string): 'high' | 'medium' | 'low' {
    if (!task.dueDate) return 'low';

    const daysUntilDue = getDaysUntilDue(task.dueDate);
    const isTaskOverdue = isOverdue(task.dueDate);

    if (isTaskOverdue) {
      return 'high';
    }

    if (alertType === 'due_today' || daysUntilDue === 0) {
      return 'high';
    }

    if (daysUntilDue === 1) {
      return 'high';
    }

    if (daysUntilDue <= 3) {
      return 'medium';
    }

    return 'low';
  }

  async getPendingAlerts(): Promise<TaskAlert[]> {
    return this.alertRepo.getPending();
  }

  async markAlertSent(alertId: string): Promise<void> {
    await this.alertRepo.markSent(alertId);
    console.log(`✅ [TaskMonitor] Marked alert ${alertId} as sent`);
  }

  async markAlertsSent(alertIds: string[]): Promise<void> {
    await this.alertRepo.markManySent(alertIds);
    console.log(`✅ [TaskMonitor] Marked ${alertIds.length} alerts as sent`);
  }

  async logQuery(
    userId: string,
    query: string,
    channel: string,
    resultsCount: number,
    responseTimeMs?: number
  ): Promise<void> {
    await this.queryLogRepo.create({
      userId,
      query,
      channel,
      resultsCount,
      responseTimeMs,
      timestamp: new Date(),
    });
    console.log(`📝 [TaskMonitor] Logged query from user ${userId}`);
  }

  private async tryGetSlackUserName(slackUserId: string): Promise<string | null> {
    return null;
  }

  formatAlertsForSlack(alerts: TaskAlert[]): string {
    if (alerts.length === 0) {
      return "No tasks found for the requested timeframe.";
    }

    const grouped = this.groupAlertsByPriority(alerts);
    const lines: string[] = [];

    if (grouped.high.length > 0) {
      lines.push(`*🔴 High Priority (${grouped.high.length})*`);
      for (const alert of grouped.high) {
        lines.push(this.formatSingleAlert(alert));
      }
      lines.push('');
    }

    if (grouped.medium.length > 0) {
      lines.push(`*🟡 Medium Priority (${grouped.medium.length})*`);
      for (const alert of grouped.medium) {
        lines.push(this.formatSingleAlert(alert));
      }
      lines.push('');
    }

    if (grouped.low.length > 0) {
      lines.push(`*🟢 Low Priority (${grouped.low.length})*`);
      for (const alert of grouped.low) {
        lines.push(this.formatSingleAlert(alert));
      }
    }

    return lines.join('\n');
  }

  private groupAlertsByPriority(alerts: TaskAlert[]): {
    high: TaskAlert[];
    medium: TaskAlert[];
    low: TaskAlert[];
  } {
    return {
      high: alerts.filter(a => a.priority === 'high'),
      medium: alerts.filter(a => a.priority === 'medium'),
      low: alerts.filter(a => a.priority === 'low'),
    };
  }

  private formatSingleAlert(alert: TaskAlert): string {
    const parts: string[] = [];
    
    const emoji = alert.alertType === 'overdue' ? '🚨' : 
                  alert.alertType === 'due_today' ? '🔔' : '📋';
    
    parts.push(`${emoji} *${alert.taskName}*`);
    
    if (alert.assignee) {
      parts.push(`   👤 ${alert.assignee}`);
    }
    
    if (alert.boardName) {
      parts.push(`   📁 ${alert.boardName}`);
    }
    
    if (alert.taskUrl) {
      parts.push(`   <${alert.taskUrl}|View Task>`);
    }

    return parts.join('\n');
  }

  formatDailySummaryForSlack(alerts: TaskAlert[]): string {
    const dateStr = formatAustralianDateOnly(new Date());
    const lines: string[] = [
      `*📅 Daily Task Summary - ${dateStr}*`,
      '',
    ];

    const overdue = alerts.filter(a => a.alertType === 'overdue');
    const dueToday = alerts.filter(a => a.alertType === 'due_today');

    if (overdue.length > 0) {
      lines.push(`*🚨 Overdue Tasks (${overdue.length})*`);
      for (const alert of overdue) {
        lines.push(this.formatSingleAlert(alert));
      }
      lines.push('');
    }

    if (dueToday.length > 0) {
      lines.push(`*🔔 Due Today (${dueToday.length})*`);
      for (const alert of dueToday) {
        lines.push(this.formatSingleAlert(alert));
      }
      lines.push('');
    }

    if (overdue.length === 0 && dueToday.length === 0) {
      lines.push('_No tasks due today or overdue. Great job staying on top of things!_ 🎉');
    }

    return lines.join('\n');
  }

  formatWeeklySummaryForSlack(alerts: TaskAlert[]): string {
    const now = new Date();
    const weekStart = formatAustralianDateOnly(getStartOfWeek(now));
    const weekEnd = formatAustralianDateOnly(getEndOfWeek(now));
    
    const lines: string[] = [
      `*📅 Weekly Task Summary (${weekStart} - ${weekEnd})*`,
      '',
    ];

    if (alerts.length === 0) {
      lines.push('_No tasks scheduled for this week._');
      return lines.join('\n');
    }

    const byDay = new Map<string, TaskAlert[]>();
    for (const alert of alerts) {
      const dayKey = formatAustralianDateOnly(alert.dueDate);
      if (!byDay.has(dayKey)) {
        byDay.set(dayKey, []);
      }
      byDay.get(dayKey)!.push(alert);
    }

    const sortedDays = [...byDay.keys()].sort();
    for (const day of sortedDays) {
      const dayAlerts = byDay.get(day)!;
      lines.push(`*${day}* (${dayAlerts.length} tasks)`);
      for (const alert of dayAlerts) {
        const assignee = alert.assignee ? ` - ${alert.assignee}` : '';
        lines.push(`  • ${alert.taskName}${assignee}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
