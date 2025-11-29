export interface DocumentLink {
  id: string;
  name: string;
  url: string;
  source: 'Monday.com' | 'SharePoint';
  fileType: string;
}

export interface TaskAlert {
  id: string;
  taskId: string;
  taskName: string;
  taskUrl: string | null;
  boardId: string | null;
  boardName: string | null;
  workspaceName: string | null;
  groupName: string | null;
  assignee: string | null;
  assigneeSlackId: string | null;
  dueDate: Date;
  status: string | null;
  statusColor: string | null;
  alertType: 'due_today' | 'due_this_week' | 'overdue' | 'upcoming_event';
  relatedDocuments: DocumentLink[];
  contextualMessage: string | null;
  priority: 'high' | 'medium' | 'low';
  sentAt: Date | null;
  createdAt: Date;
}

export interface UserMapping {
  id?: number;
  mondayUserId: string;
  slackUserId: string;
  mondayEmail?: string | null;
  displayName?: string | null;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface QueryLogEntry {
  id?: number;
  userId: string;
  userName?: string | null;
  query: string;
  intent?: string | null;
  channel?: string | null;
  resultsCount: number;
  responseTimeMs?: number | null;
  timestamp: Date;
}

export type AlertType = TaskAlert['alertType'];
export type AlertPriority = TaskAlert['priority'];
