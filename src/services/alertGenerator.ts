import type { Task } from '../monday/types.js';
import { getDaysUntilDue, formatAustralianDateShort, isOverdue } from '../utils/dateUtils.js';

interface ReminderTemplate {
  pattern: RegExp;
  daysBeforeReminders: number[];
  messages: Record<number, string>;
  checklist?: string[];
}

export class AlertGenerator {
  private reminderTemplates: ReminderTemplate[] = [
    {
      pattern: /round\s*table/i,
      daysBeforeReminders: [7, 3, 1, 0],
      messages: {
        7: '📅 Round table one week away. Have we done the name badges?\n\n*Checklist:*\n• Name badges prepared\n• Agenda finalized\n• Room booking confirmed\n• Catering ordered',
        3: '📅 Round table in 3 days! Time to finalize agenda and confirm attendees.',
        1: '⚠️ Round table is TOMORROW! Final preparations needed.',
        0: '🔔 Round table is TODAY! Arrive early for setup.',
      },
      checklist: [
        'Name badges prepared',
        'Agenda finalized',
        'Room booking confirmed',
        'Catering ordered',
        'AV equipment tested',
        'Attendee list confirmed',
      ],
    },
    {
      pattern: /presentation|pitch|deck/i,
      daysBeforeReminders: [5, 2, 1, 0],
      messages: {
        5: '🎯 Presentation in 5 days. Review deck with stakeholders.',
        2: '🎯 Presentation in 2 days! Final review and practice.',
        1: '⚠️ Presentation is TOMORROW! Final preparations.',
        0: '🔔 Presentation is TODAY! You\'ve got this! 💪',
      },
      checklist: [
        'Deck reviewed by stakeholders',
        'Practice run completed',
        'Backup of presentation saved',
        'AV setup confirmed',
      ],
    },
    {
      pattern: /campaign\s*launch|go.?live/i,
      daysBeforeReminders: [7, 3, 1, 0],
      messages: {
        7: '🚀 Campaign launch one week out!\n\n*Pre-launch checklist:*\n• Creative assets approved\n• Landing page tested\n• Tracking pixels installed\n• Team briefed',
        3: '🚀 Campaign launches in 3 days! Final QA checks.',
        1: '⚠️ Campaign launches TOMORROW! Stakeholder sign-off needed.',
        0: '🚀 LAUNCH DAY! Monitor closely for first 2 hours.',
      },
      checklist: [
        'Creative assets approved',
        'Landing page tested',
        'Tracking pixels installed',
        'Team briefed',
        'Budget confirmed',
        'Stakeholder sign-off received',
      ],
    },
    {
      pattern: /client\s*meeting|client\s*call/i,
      daysBeforeReminders: [3, 1, 0],
      messages: {
        3: '📞 Client meeting in 3 days. Review account status.',
        1: '📞 Client meeting TOMORROW! Finalize presentation.',
        0: '📞 Client meeting TODAY! Join 5 minutes early.',
      },
      checklist: [
        'Account status reviewed',
        'Meeting agenda prepared',
        'Key talking points noted',
        'Questions for client ready',
      ],
    },
    {
      pattern: /deadline|due|submit|delivery/i,
      daysBeforeReminders: [3, 1, 0],
      messages: {
        3: '📋 Deadline in 3 days. Check progress and blockers.',
        1: '⚠️ Deadline is TOMORROW! Final push needed.',
        0: '🔔 Deadline is TODAY! Submit before end of day.',
      },
    },
    {
      pattern: /review|approval|sign.?off/i,
      daysBeforeReminders: [2, 1, 0],
      messages: {
        2: '✍️ Review/approval needed in 2 days.',
        1: '✍️ Review/approval needed TOMORROW!',
        0: '✍️ Review/approval needed TODAY!',
      },
    },
    {
      pattern: /event|conference|workshop/i,
      daysBeforeReminders: [7, 3, 1, 0],
      messages: {
        7: '📆 Event one week away. Confirm logistics and materials.',
        3: '📆 Event in 3 days! Final preparations.',
        1: '📆 Event is TOMORROW! Last-minute checks.',
        0: '📆 Event is TODAY! Good luck!',
      },
      checklist: [
        'Venue confirmed',
        'Materials prepared',
        'Attendee communications sent',
        'Logistics finalized',
      ],
    },
    {
      pattern: /photoshoot|video\s*shoot|filming/i,
      daysBeforeReminders: [5, 2, 1, 0],
      messages: {
        5: '📸 Shoot in 5 days. Confirm talent and location.',
        2: '📸 Shoot in 2 days! Final production meeting needed.',
        1: '📸 Shoot is TOMORROW! All preparations complete?',
        0: '📸 Shoot is TODAY! Call time reminder sent?',
      },
      checklist: [
        'Talent confirmed',
        'Location secured',
        'Equipment ready',
        'Shot list finalized',
        'Wardrobe/props prepared',
      ],
    },
  ];

  generateContextualMessage(task: Task, alertType: string): string | null {
    if (!task.dueDate) return null;

    const daysUntilDue = getDaysUntilDue(task.dueDate);
    const isTaskOverdue = isOverdue(task.dueDate);

    console.log(`📝 [AlertGenerator] Generating message for "${task.name}" (due in ${daysUntilDue} days, overdue: ${isTaskOverdue})`);

    if (isTaskOverdue) {
      return this.getOverdueMessage(task, Math.abs(daysUntilDue));
    }

    const matchingTemplate = this.reminderTemplates.find(template => 
      template.pattern.test(task.name)
    );

    if (matchingTemplate) {
      const closestDay = this.findClosestReminderDay(daysUntilDue, matchingTemplate.daysBeforeReminders);
      if (closestDay !== null && matchingTemplate.messages[closestDay]) {
        console.log(`✅ [AlertGenerator] Matched template for "${task.name}" with ${closestDay} days message`);
        return matchingTemplate.messages[closestDay];
      }
    }

    return this.getDefaultMessage(daysUntilDue, alertType, task);
  }

  generateChecklist(task: Task): string[] | null {
    const matchingTemplate = this.reminderTemplates.find(template => 
      template.pattern.test(task.name) && template.checklist
    );

    if (matchingTemplate?.checklist) {
      console.log(`📋 [AlertGenerator] Generated checklist for "${task.name}"`);
      return matchingTemplate.checklist;
    }

    return null;
  }

  private findClosestReminderDay(daysUntilDue: number, daysBeforeReminders: number[]): number | null {
    const sortedDays = [...daysBeforeReminders].sort((a, b) => b - a);
    
    for (const day of sortedDays) {
      if (daysUntilDue <= day) {
        return day;
      }
    }
    
    if (daysUntilDue >= 0 && daysUntilDue <= sortedDays[0]) {
      return sortedDays.find(d => d >= daysUntilDue) || sortedDays[sortedDays.length - 1];
    }

    return null;
  }

  private getOverdueMessage(task: Task, daysOverdue: number): string {
    const dueDateStr = task.dueDate ? formatAustralianDateShort(task.dueDate) : 'unknown';
    
    if (daysOverdue === 0) {
      return `🚨 OVERDUE: "${task.name}" was due today!`;
    } else if (daysOverdue === 1) {
      return `🚨 OVERDUE by 1 day: "${task.name}" was due ${dueDateStr}. Please address urgently.`;
    } else if (daysOverdue <= 3) {
      return `🚨 OVERDUE by ${daysOverdue} days: "${task.name}" was due ${dueDateStr}. Needs immediate attention!`;
    } else if (daysOverdue <= 7) {
      return `⚠️ OVERDUE by ${daysOverdue} days: "${task.name}" was due ${dueDateStr}. Please update status or complete.`;
    } else {
      return `⚠️ OVERDUE by ${daysOverdue} days: "${task.name}" was due ${dueDateStr}. Consider if this task is still relevant.`;
    }
  }

  private getDefaultMessage(daysUntilDue: number, alertType: string, task: Task): string | null {
    const taskName = task.name;
    const dueDateStr = task.dueDate ? formatAustralianDateShort(task.dueDate) : '';

    if (alertType === 'due_today') {
      return `🔔 Due today: "${taskName}"`;
    }

    if (daysUntilDue === 0) {
      return `🔔 Due today: "${taskName}"`;
    } else if (daysUntilDue === 1) {
      return `⚠️ Due tomorrow: "${taskName}"`;
    } else if (daysUntilDue <= 3) {
      return `📅 Due in ${daysUntilDue} days (${dueDateStr}): "${taskName}"`;
    } else if (daysUntilDue <= 7) {
      return `📋 Due this week (${dueDateStr}): "${taskName}"`;
    }

    return `📋 Upcoming (${dueDateStr}): "${taskName}"`;
  }

  formatAlertForSlack(
    contextualMessage: string,
    task: Task,
    checklist: string[] | null,
    relatedDocs: { name: string; url: string }[]
  ): string {
    let message = contextualMessage;

    if (task.assigneeName) {
      message += `\n*Assignee:* ${task.assigneeName}`;
    }

    if (task.boardName) {
      message += `\n*Board:* ${task.boardName}`;
    }

    if (task.status) {
      message += `\n*Status:* ${task.status}`;
    }

    if (task.url) {
      message += `\n*Task Link:* <${task.url}|View in Monday.com>`;
    }

    if (checklist && checklist.length > 0) {
      message += '\n\n*Checklist:*';
      for (const item of checklist) {
        message += `\n• ${item}`;
      }
    }

    if (relatedDocs.length > 0) {
      message += '\n\n*Related Documents:*';
      for (const doc of relatedDocs.slice(0, 5)) {
        message += `\n• <${doc.url}|${doc.name}>`;
      }
    }

    return message;
  }
}

export const alertGenerator = new AlertGenerator();
