const TIMEZONE = 'Australia/Sydney';

export function getAustralianDate(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  return new Date(
    parseInt(getPart('year')),
    parseInt(getPart('month')) - 1,
    parseInt(getPart('day')),
    parseInt(getPart('hour')),
    parseInt(getPart('minute')),
    parseInt(getPart('second'))
  );
}

export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getEndOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function getStartOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getEndOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function formatAustralianDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatAustralianDateShort(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function getDaysUntilDue(dueDate: Date): number {
  const now = getAustralianDate();
  const due = new Date(dueDate);
  
  const nowStart = getStartOfDay(now);
  const dueStart = getStartOfDay(due);
  
  const diffTime = dueStart.getTime() - nowStart.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

export function isToday(date: Date): boolean {
  const now = getAustralianDate();
  const target = new Date(date);
  
  return (
    now.getFullYear() === target.getFullYear() &&
    now.getMonth() === target.getMonth() &&
    now.getDate() === target.getDate()
  );
}

export function isOverdue(date: Date): boolean {
  const now = getAustralianDate();
  const dueEnd = getEndOfDay(new Date(date));
  return now > dueEnd;
}

export function isTomorrow(date: Date): boolean {
  const tomorrow = getAustralianDate();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(date);
  
  return (
    tomorrow.getFullYear() === target.getFullYear() &&
    tomorrow.getMonth() === target.getMonth() &&
    tomorrow.getDate() === target.getDate()
  );
}

export function isThisWeek(date: Date): boolean {
  const now = getAustralianDate();
  const weekStart = getStartOfWeek(now);
  const weekEnd = getEndOfWeek(now);
  const target = new Date(date);
  
  return target >= weekStart && target <= weekEnd;
}

export function isNextWeek(date: Date): boolean {
  const now = getAustralianDate();
  const nextWeekStart = getStartOfWeek(now);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const nextWeekEnd = getEndOfWeek(nextWeekStart);
  const target = new Date(date);
  
  return target >= nextWeekStart && target <= nextWeekEnd;
}

export function getRelativeDueDescription(date: Date): string {
  if (isOverdue(date)) {
    const days = Math.abs(getDaysUntilDue(date));
    return days === 1 ? 'Overdue by 1 day' : `Overdue by ${days} days`;
  }
  
  if (isToday(date)) {
    return 'Due today';
  }
  
  if (isTomorrow(date)) {
    return 'Due tomorrow';
  }
  
  const days = getDaysUntilDue(date);
  if (days <= 7) {
    return `Due in ${days} days`;
  }
  
  return `Due ${formatAustralianDateShort(date)}`;
}

export { TIMEZONE };
