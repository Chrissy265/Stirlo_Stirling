import { pgTable, serial, varchar, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: text('password').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  role: varchar('role', { length: 50 }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Lovable users table for web frontend integration
export const lovableUsers = pgTable('lovable_users', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// User mappings between Monday.com and Slack
export const userMappings = pgTable('user_mappings', {
  id: serial('id').primaryKey(),
  mondayUserId: varchar('monday_user_id', { length: 50 }).notNull().unique(),
  slackUserId: varchar('slack_user_id', { length: 50 }).notNull(),
  mondayEmail: varchar('monday_email', { length: 255 }),
  displayName: varchar('display_name', { length: 200 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Task alerts history
export const taskAlerts = pgTable('task_alerts', {
  id: varchar('id', { length: 100 }).primaryKey(),
  taskId: varchar('task_id', { length: 50 }).notNull(),
  taskName: text('task_name').notNull(),
  taskUrl: text('task_url'),
  boardId: varchar('board_id', { length: 50 }),
  boardName: varchar('board_name', { length: 200 }),
  workspaceName: varchar('workspace_name', { length: 200 }),
  groupName: varchar('group_name', { length: 200 }),
  assignee: varchar('assignee', { length: 200 }),
  assigneeSlackId: varchar('assignee_slack_id', { length: 50 }),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 50 }),
  statusColor: varchar('status_color', { length: 20 }),
  alertType: varchar('alert_type', { length: 50 }).notNull(),
  relatedDocuments: jsonb('related_documents').default([]),
  contextualMessage: text('contextual_message'),
  priority: varchar('priority', { length: 20 }).default('medium'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Task snoozes for deferred notifications
export const taskSnoozes = pgTable('task_snoozes', {
  id: serial('id').primaryKey(),
  alertId: varchar('alert_id', { length: 100 }).notNull(),
  taskId: varchar('task_id', { length: 50 }).notNull(),
  userId: varchar('user_id', { length: 50 }).notNull(),
  snoozeUntil: timestamp('snooze_until', { withTimezone: true }).notNull(),
  duration: varchar('duration', { length: 20 }).notNull(),
  processed: boolean('processed').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Query log for visibility (track what team members ask)
export const queryLog = pgTable('query_log', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 50 }).notNull(),
  userName: varchar('user_name', { length: 200 }),
  query: text('query').notNull(),
  intent: varchar('intent', { length: 50 }),
  channel: varchar('channel', { length: 50 }),
  resultsCount: integer('results_count').default(0),
  responseTimeMs: integer('response_time_ms'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
});
