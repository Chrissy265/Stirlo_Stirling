import { TaskAlert } from '../../types/monitoring';

export function getUrgencyEmoji(alert: TaskAlert): string {
  if (alert.alertType === 'overdue') return '🚨';
  if (alert.alertType === 'due_today') return '⚠️';
  if (alert.alertType === 'upcoming_event') return '📅';
  if (alert.priority === 'high') return '📌';
  return '📋';
}

export function getPriorityEmoji(priority: TaskAlert['priority']): string {
  switch (priority) {
    case 'high': return '🔴';
    case 'medium': return '🟡';
    case 'low': return '⚪';
    default: return '⚪';
  }
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short'
  }).format(date);
}

export function formatDayName(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long' }).format(date);
}

export function groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const groupKey = String(item[key] ?? 'Unassigned');
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
  }
  return result;
}

export function groupByDay(alerts: TaskAlert[]): Record<string, TaskAlert[]> {
  const result: Record<string, TaskAlert[]> = {};
  for (const alert of alerts) {
    const dayName = formatDayName(alert.dueDate);
    if (!result[dayName]) {
      result[dayName] = [];
    }
    result[dayName].push(alert);
  }
  return result;
}

export function sortByDueDate(alerts: TaskAlert[]): TaskAlert[] {
  return [...alerts].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

export function safeString(value: string | null | undefined, fallback: string = 'N/A'): string {
  return value ?? fallback;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function escapeSlackMrkdwn(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
