const TIMEZONE = 'Australia/Sydney';

function getAustralianDateParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  const weekdayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
  };
}

function findMidnightUtc(year: number, month: number, day: number): Date {
  const searchStart = Date.UTC(year, month - 1, day - 1, 0, 0, 0, 0);
  
  for (let h = 0; h < 48; h++) {
    const testTime = searchStart + h * 60 * 60 * 1000;
    const testParts = getAustralianDateParts(new Date(testTime));
    
    if (testParts.year === year && testParts.month === month && testParts.day === day && testParts.hour === 0) {
      const exactTime = testTime - (testParts.minute * 60 + testParts.second) * 1000;
      return new Date(exactTime);
    }
  }
  
  return new Date(Date.UTC(year, month - 1, day - 1, 14, 0, 0, 0));
}

export function getAustralianDateComponents(date: Date): { year: number; month: number; day: number; hour: number; minute: number; dayOfWeek: number } {
  const parts = getAustralianDateParts(date);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    dayOfWeek: parts.dayOfWeek,
  };
}

export function getStartOfDayInAustralia(date: Date): Date {
  const parts = getAustralianDateParts(date);
  return findMidnightUtc(parts.year, parts.month, parts.day);
}

export function getEndOfDayInAustralia(date: Date): Date {
  const parts = getAustralianDateParts(date);
  const year = parts.month === 12 && parts.day === 31 ? parts.year + 1 : parts.year;
  const month = parts.day === 31 && parts.month === 12 ? 1 : 
                parts.day === 31 || 
                (parts.day === 30 && [4, 6, 9, 11].includes(parts.month)) ||
                (parts.day >= 28 && parts.month === 2) ? parts.month + 1 : parts.month;
  const day = month !== parts.month ? 1 : parts.day + 1;
  
  const nextDayMidnight = findMidnightUtc(year, month, day);
  return new Date(nextDayMidnight.getTime() - 1);
}

export function getStartOfWeekInAustralia(date: Date): Date {
  const parts = getAustralianDateParts(date);
  const dayOfWeek = parts.dayOfWeek;
  
  const diffDays = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  
  const adjustedDate = new Date(date.getTime() + diffDays * 24 * 60 * 60 * 1000);
  return getStartOfDayInAustralia(adjustedDate);
}

export function getEndOfWeekInAustralia(date: Date): Date {
  const parts = getAustralianDateParts(date);
  const dayOfWeek = parts.dayOfWeek;
  
  const diffDays = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  
  const adjustedDate = new Date(date.getTime() + diffDays * 24 * 60 * 60 * 1000);
  return getEndOfDayInAustralia(adjustedDate);
}

export function getNowInAustralia(): Date {
  return new Date();
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

export function formatAustralianDateOnly(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function getDaysUntilDue(dueDate: Date): number {
  const now = new Date();
  const nowStart = getStartOfDayInAustralia(now);
  const dueStart = getStartOfDayInAustralia(dueDate);
  
  const diffTime = dueStart.getTime() - nowStart.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

export function isTodayInAustralia(date: Date): boolean {
  const now = new Date();
  const nowParts = getAustralianDateParts(now);
  const dateParts = getAustralianDateParts(date);
  
  return (
    nowParts.year === dateParts.year &&
    nowParts.month === dateParts.month &&
    nowParts.day === dateParts.day
  );
}

export function isOverdueInAustralia(date: Date): boolean {
  const now = new Date();
  const dueEnd = getEndOfDayInAustralia(date);
  return now > dueEnd;
}

export function isTomorrowInAustralia(date: Date): boolean {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = getAustralianDateParts(tomorrow);
  const dateParts = getAustralianDateParts(date);
  
  return (
    tomorrowParts.year === dateParts.year &&
    tomorrowParts.month === dateParts.month &&
    tomorrowParts.day === dateParts.day
  );
}

export function isThisWeekInAustralia(date: Date): boolean {
  const now = new Date();
  const weekStart = getStartOfWeekInAustralia(now);
  const weekEnd = getEndOfWeekInAustralia(now);
  
  return date >= weekStart && date <= weekEnd;
}

export function isNextWeekInAustralia(date: Date): boolean {
  const now = new Date();
  const thisWeekEnd = getEndOfWeekInAustralia(now);
  const nextWeekStart = new Date(thisWeekEnd.getTime() + 1);
  const nextWeekEnd = getEndOfWeekInAustralia(nextWeekStart);
  
  return date >= nextWeekStart && date <= nextWeekEnd;
}

export function getRelativeDueDescription(date: Date): string {
  if (isOverdueInAustralia(date)) {
    const days = Math.abs(getDaysUntilDue(date));
    return days === 0 ? 'Overdue' : days === 1 ? 'Overdue by 1 day' : `Overdue by ${days} days`;
  }
  
  if (isTodayInAustralia(date)) {
    return 'Due today';
  }
  
  if (isTomorrowInAustralia(date)) {
    return 'Due tomorrow';
  }
  
  const days = getDaysUntilDue(date);
  if (days <= 7) {
    return `Due in ${days} days`;
  }
  
  return `Due ${formatAustralianDateShort(date)}`;
}

export function getAustralianDate(): Date {
  return new Date();
}

export function getStartOfDay(date: Date): Date {
  return getStartOfDayInAustralia(date);
}

export function getEndOfDay(date: Date): Date {
  return getEndOfDayInAustralia(date);
}

export function getStartOfWeek(date: Date): Date {
  return getStartOfWeekInAustralia(date);
}

export function getEndOfWeek(date: Date): Date {
  return getEndOfWeekInAustralia(date);
}

export function isToday(date: Date): boolean {
  return isTodayInAustralia(date);
}

export function isOverdue(date: Date): boolean {
  return isOverdueInAustralia(date);
}

export function isTomorrow(date: Date): boolean {
  return isTomorrowInAustralia(date);
}

export function isThisWeek(date: Date): boolean {
  return isThisWeekInAustralia(date);
}

export function isNextWeek(date: Date): boolean {
  return isNextWeekInAustralia(date);
}

export { TIMEZONE };
