-- Task Monitoring System Database Schema
-- Migration 002: User mappings, task alerts, and query logging

-- User mappings between Monday.com and Slack
CREATE TABLE IF NOT EXISTS user_mappings (
    id SERIAL PRIMARY KEY,
    monday_user_id VARCHAR(50) UNIQUE NOT NULL,
    slack_user_id VARCHAR(50) NOT NULL,
    monday_email VARCHAR(255),
    display_name VARCHAR(200),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mappings_monday ON user_mappings(monday_user_id);
CREATE INDEX IF NOT EXISTS idx_user_mappings_slack ON user_mappings(slack_user_id);

-- Task alerts history
CREATE TABLE IF NOT EXISTS task_alerts (
    id VARCHAR(100) PRIMARY KEY,
    task_id VARCHAR(50) NOT NULL,
    task_name TEXT NOT NULL,
    task_url TEXT,
    board_id VARCHAR(50),
    board_name VARCHAR(200),
    workspace_name VARCHAR(200),
    group_name VARCHAR(200),
    assignee VARCHAR(200),
    assignee_slack_id VARCHAR(50),
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50),
    status_color VARCHAR(20),
    alert_type VARCHAR(50) NOT NULL,
    related_documents JSONB DEFAULT '[]',
    contextual_message TEXT,
    priority VARCHAR(20) DEFAULT 'medium',
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_alerts_due_date ON task_alerts(due_date);
CREATE INDEX IF NOT EXISTS idx_task_alerts_assignee ON task_alerts(assignee_slack_id);
CREATE INDEX IF NOT EXISTS idx_task_alerts_sent ON task_alerts(sent_at) WHERE sent_at IS NULL;

-- Query log for visibility (track what team members ask)
CREATE TABLE IF NOT EXISTS query_log (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    user_name VARCHAR(200),
    query TEXT NOT NULL,
    intent VARCHAR(50),
    channel VARCHAR(50),
    results_count INTEGER DEFAULT 0,
    response_time_ms INTEGER,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_log_timestamp ON query_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_query_log_user ON query_log(user_id);
