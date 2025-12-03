# Stirlo Intelligent Assistant

## Overview

Stirlo is an AI-powered intelligent assistant that operates across multiple platforms (Slack and web interface) to help teams access organizational knowledge and manage tasks. The system integrates with SharePoint, Monday.com, and maintains conversation memory using PostgreSQL with vector embeddings. Built on the Mastra framework, it uses GPT-based language models to provide natural, conversational responses while searching across multiple data sources.

The application is deployed on Render with Socket Mode for Slack connectivity, eliminating the need for webhook configurations. It features a keep-alive service to prevent idle timeouts and supports both real-time chat through Slack and web-based interactions through an Express server.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Framework & Runtime
- **Framework**: Mastra (v0.20.0+) - AI agent orchestration framework
- **Runtime**: Node.js 20.9.0+ with ES modules
- **Language**: TypeScript compiled to ES2022
- **Build Tool**: Mastra CLI with bundler module resolution
- **Deployment**: Render platform with production builds in `.mastra/output` directory

**Rationale**: Mastra provides built-in agent orchestration, workflow management, and integration patterns. Socket Mode was chosen over webhooks to work behind firewalls and simplify deployment without exposing public endpoints.

### Agent Architecture
- **Primary Agent**: `intelligentAssistant` - Multi-step reasoning agent (max 5 steps)
- **Model**: Anthropic Claude Sonnet 4.5 via `@ai-sdk/anthropic`
- **Environment Detection**: Auto-detects Replit AI Integrations vs direct API key
- **Tool Execution**: Synchronous tool calls with structured Zod schema validation
- **Memory**: Persistent conversation threads stored in PostgreSQL with RAG capabilities

**Tools Available**:
1. **SharePoint Search** - Searches across Stirling Central organization documents
2. **Monday.com Search** - Queries tasks, projects, documents, and updates with mandatory search priority
3. **RAG Semantic Search** - Vector-based search over past conversations using pgvector

**Rationale**: Migrated from OpenAI GPT to Anthropic Claude for improved production reliability. Multi-step reasoning allows the agent to chain tool calls and refine responses. Zod schemas ensure type safety and validate inputs before execution.

### Task Monitoring Infrastructure (Phase 1-6 Complete)
- **Timezone Handling**: DST-aware Australia/Sydney timezone utilities
- **Algorithm**: Hourly iteration (O(48)) to find correct midnight boundaries during DST transitions
- **Database Tables**: user_mappings, task_alerts, query_log with proper indexes
- **Repositories**: AlertRepository, UserMappingRepository, QueryLogRepository using Drizzle ORM patterns
- **Task Monitor Service**: Unified task fetching from all Monday.com boards with due date filtering
- **Slack Message Formatters**: Block Kit message builders for task alerts with action buttons
- **SlackNotifier Class**: Channel/DM message sending with thread support

**On-Demand Task Commands (Phase 5)**:
Users can query tasks via @-mentions in any channel:
- `@Stirlo tasks today` - Team tasks due today
- `@Stirlo tasks week` - Team tasks due this week  
- `@Stirlo tasks overdue` - All overdue team tasks
- `@Stirlo my today` - Personal tasks due today
- `@Stirlo my week` - Personal tasks due this week
- `@Stirlo trigger daily` - Manually trigger daily team summary
- `@Stirlo trigger weekly` - Manually trigger weekly team summary
- `@Stirlo help` - Show available commands

**Scheduled Triggers (Phase 6)**:
HTTP endpoints for external cron job services (Render, etc.):
- **Daily Trigger** (`POST /api/cron/daily`): Runs 8 AM AEST daily
  - Sends team summary to #stirlo-assistant
  - Sends individual DMs to assignees (one per person)
  - Includes both due-today and overdue tasks
- **Weekly Trigger** (`POST /api/cron/weekly`): Runs 8 AM AEST Monday mornings
  - Sends weekly overview to #stirlo-assistant
  - Sends personal weekly outlook DMs to each team member
- **Status Endpoint** (`GET /api/cron/status`): Check cron configuration

**Render Cron Job Configuration** (Production):
Configure these cron jobs in your Render dashboard under "Cron Jobs":

| Job | Schedule (UTC) | URL | Description |
|-----|----------------|-----|-------------|
| Daily | `0 21 * * *` | `POST https://your-app.onrender.com/api/cron/daily` | 8 AM AEDT (summer) |
| Weekly | `0 21 * * 0` | `POST https://your-app.onrender.com/api/cron/weekly` | Monday 8 AM AEDT |

**Important Notes**:
- Render cron jobs use UTC time, not AEST/AEDT
- `0 21 * * *` = 9 PM UTC = 8 AM AEDT (Australian Eastern Daylight Time - summer)
- During winter (AEST), adjust to `0 22 * * *` for 8 AM AEST
- Weekly runs Sunday 9 PM UTC which is Monday 8 AM AEDT
- Add `CRON_SECRET` environment variable on Render for authentication
- Include `Authorization: Bearer YOUR_CRON_SECRET` header in cron job requests

**Environment Variables for Cron**:
- `CRON_SECRET`: Shared secret for authenticating cron requests (optional but recommended)
- `TEAM_CHANNEL_ID`: Slack channel ID for team notifications (e.g., C09PHGX6YDU)
- `ERROR_CHANNEL_ID`: Slack channel ID for error alerts (e.g., C0A0AFTQDGB)

**Legacy: Replit Scheduled Deployment Configuration** (if using Replit):
1. Daily: Cron `0 8 * * *`, Timezone `Australia/Sydney`, Command `npm run trigger:daily`
2. Weekly: Cron `0 8 * * 1`, Timezone `Australia/Sydney`, Command `npm run trigger:weekly`

**Key Files**:
- `src/utils/dateUtils.ts` - Australian timezone utilities with DST support
- `src/database/repositories/*.ts` - Database access layer
- `src/types/monitoring.ts` - TypeScript type definitions
- `src/services/taskMonitor.ts` - Central task fetching and filtering
- `src/slack/handlers/taskCommandParser.ts` - Command detection and parsing
- `src/slack/handlers/taskCommandHandler.ts` - Command execution and response formatting
- `src/slack/messages/*.ts` - Block Kit message formatters
- `scripts/dailyTrigger.ts` - Daily scheduled notification script
- `scripts/weeklyTrigger.ts` - Weekly scheduled notification script

### Slack Integration
- **Connection**: Socket Mode via `@slack/socket-mode` and `@slack/web-api`
- **Authentication**: App-level token (SLACK_APP_TOKEN) and bot token (SLACK_BOT_TOKEN)
- **Event Handling**: Listens for direct messages and @mentions in channels
- **Workflow**: `slackIntelligentAssistantWorkflow` orchestrates message processing
- **Message Processing**: 
  - Adds ⏳ reaction while processing
  - Strips markdown formatting (asterisks, bold) for clean Slack messages
  - Removes reaction after posting response
  - Thread-based conversations

**Rationale**: Socket Mode maintains a persistent WebSocket connection, avoiding webhook complexity and working behind firewalls. Inngest workflows provide reliable async execution with retry logic.

### Web Interface
- **Server**: Express 5.1.0 with cookie-parser middleware
- **Frontend**: React-based chat UI (served from public directory)
- **Authentication**: Session-based with bcrypt password hashing (10 salt rounds)
- **Session Management**: 
  - HTTP-only cookies with SameSite=strict
  - 7-day expiration
  - Secure flag in production
  - In-memory session store (development only)

**Database Schema**:
```
Users: id, email (unique), password (bcrypt), name, created_at
Messages: id, user_id (FK), role ('user'|'assistant'), content, created_at
```

**Rationale**: Session-based auth chosen over JWT for simplicity and automatic CSRF protection with SameSite cookies. In-memory sessions acceptable for development but require Redis/persistent store for production.

### Data Storage
- **Primary Database**: PostgreSQL (Neon-hosted) with pgvector extension
- **ORM**: Drizzle ORM v0.44.7+ with Drizzle Kit for migrations
- **Connection**: `@mastra/pg` adapter for Mastra integration
- **Vector Storage**: pgvector for semantic search and RAG embeddings
- **Schema Management**: Type-safe schema definitions with Drizzle's TypeScript API

**Rationale**: PostgreSQL with pgvector enables both relational data storage and vector embeddings in a single database. Drizzle provides type-safe queries and automatic migration generation.

### Workflow Management
- **Engine**: Inngest v3.40.2+ for durable workflow execution
- **Workflows**: 
  - `slackIntelligentAssistantWorkflow` - Main message processing pipeline
- **Scheduled Scripts**: Standalone trigger scripts for Replit Scheduled Deployments
  - `scripts/dailyTrigger.ts` - Daily notifications at 8 AM AEST
  - `scripts/weeklyTrigger.ts` - Weekly summaries at 8 AM AEST Mondays
- **Integration**: `@mastra/inngest` adapter
- **Execution**: Multi-step execution with automatic retries and error handling

**Rationale**: Inngest provides durable execution with built-in retry logic, making it ideal for long-running agent workflows that may involve multiple API calls. Scheduled notifications use standalone scripts with Replit's Scheduled Deployments for reliable cron-like execution.

### Keep-Alive Service (Render-Specific)
- **Mechanism**: Self-pinging service hitting `/api/health` every 5 minutes
- **Purpose**: Prevents Render free tier from idling
- **Implementation**: Custom service in Mastra initialization
- **Monitoring**: Logs success rate and response times

**Rationale**: Render's free tier spins down after inactivity. The keep-alive service ensures the Slack Socket Mode connection stays active 24/7.

## External Dependencies

### Third-Party Services
1. **Slack API**
   - Bot token authentication (SLACK_BOT_TOKEN)
   - App-level token for Socket Mode (SLACK_APP_TOKEN)
   - Signing secret for request verification (SLACK_SIGNING_SECRET)
   - Permissions: `app_mentions:read`, `chat:write`, `channels:history`, `im:history`, `reactions:write`

2. **Anthropic API**
   - Environment-aware: Replit AI Integrations (AI_INTEGRATIONS_ANTHROPIC_*) or direct API key (ANTHROPIC_API_KEY)
   - Model: Claude Sonnet 4.5 via AI SDK
   - Usage: Agent reasoning and response generation

3. **Microsoft SharePoint**
   - OAuth2 authentication with client credentials flow
   - Required: SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET, SHAREPOINT_TENANT_ID
   - Integration: `@microsoft/microsoft-graph-client`
   - Searches: Stirling Central organization documents

4. **Monday.com**
   - API key authentication (MONDAY_API_KEY)
   - GraphQL API for tasks, boards, documents, and updates
   - Complexity limits: 5,000,000 per query (monitor for overruns)
   - Search priority: Mandatory first search for organizational context

5. **Neon PostgreSQL**
   - Hosted PostgreSQL with pgvector extension
   - Connection: DATABASE_URL environment variable
   - Purpose: User data, messages, conversation history, vector embeddings

### Infrastructure
1. **Render**
   - Platform: Web service deployment
   - Build: `npm ci && npm run build` (Mastra CLI)
   - Start: `cd .mastra/output && NODE_ENV=production node index.mjs`
   - Environment: Production builds with 748 optimized packages
   - URL: RENDER_EXTERNAL_URL for keep-alive service

2. **Session Management**
   - Development: In-memory session store
   - Production (Required): Redis or PostgreSQL-backed session store
   - Secret: SESSION_SECRET for cookie signing

### NPM Packages (Key Dependencies)
- **AI/ML**: `@ai-sdk/openai`, `ai` (Vercel AI SDK)
- **Mastra Core**: `@mastra/core`, `@mastra/inngest`, `@mastra/pg`, `@mastra/memory`
- **Slack**: `@slack/socket-mode`, `@slack/web-api`
- **Microsoft**: `@microsoft/microsoft-graph-client`
- **Database**: `drizzle-orm`, `drizzle-kit`
- **Web Server**: `express`, `cookie-parser`, `bcrypt`
- **Validation**: `zod`
- **Logging**: `pino`
- **Utilities**: `dotenv`, `tsx`, `inngest-cli`

### Security Considerations
- All passwords hashed with bcrypt (10 rounds)
- HTTP-only cookies prevent XSS attacks
- SameSite=strict cookies prevent CSRF
- Parameterized queries via Drizzle ORM prevent SQL injection
- HTTPS required for production (Secure cookie flag)
- Environment variables for all sensitive credentials
- Session secrets cryptographically random

### Known Limitations
1. **Monday.com API**: Query complexity limit (5M) can be exceeded with large searches
2. **Session Storage**: In-memory sessions lost on restart (requires persistent store for production)
3. **Slack Socket Mode**: Only one active connection allowed per app token
4. **Render Free Tier**: Requires keep-alive service to prevent idling
5. **HTTPS**: Not enforced in development but required for production

## Proactive Task Monitoring

### Overview
Stirlo includes a comprehensive Proactive Task Monitoring system that automatically keeps the team informed about upcoming deadlines, overdue tasks, and weekly workloads by pulling data from Monday.com and delivering it directly to Slack.

### Key Features
| Feature | Description |
|---------|-------------|
| **Daily Notifications** | Automatic summary of tasks due today + overdue items sent every morning |
| **Weekly Overview** | Monday morning summary showing the entire week's tasks organized by day |
| **Personal Summaries** | Individual DMs sent to each team member with just their assigned tasks |
| **Team Channel Posts** | Full team summaries posted to #stirlo-assistant |
| **Clickable Task Links** | Every task name links directly to Monday.com for quick access |
| **Smart Truncation** | Large task lists are automatically truncated to prevent Slack's 50-block limit |
| **Error Alerts** | Failures are reported to #error-stirlo for quick troubleshooting |
| **Retry Logic** | Automatic retries with exponential backoff for transient Monday.com API failures |

### Benefits
1. **Never Miss a Deadline** - Get reminded about due dates before they become overdue
2. **Team Visibility** - Everyone sees the full workload in #stirlo-assistant
3. **Personal Focus** - Get a filtered view of just YOUR tasks via DM
4. **One-Click Access** - Task names are clickable links to Monday.com
5. **Hands-Free** - Runs automatically on schedule, no manual intervention needed
6. **On-Demand Access** - Query task status anytime with Slack commands
7. **Reliable Delivery** - Retry logic ensures tasks are extracted even during API instability

### Automatic Trigger Schedule
| Trigger | Schedule | Timezone | Render Cron (UTC) | What It Does |
|---------|----------|----------|-------------------|--------------|
| **Daily** | Every day at 8:00 AM | Australia/Sydney | `0 21 * * *` | Posts today's tasks + overdue to #stirlo-assistant, sends personal DMs |
| **Weekly** | Every Monday at 8:00 AM | Australia/Sydney | `0 21 * * 0` | Posts weekly overview to #stirlo-assistant, sends personal weekly DMs |

**Note**: Render cron jobs are configured via the Render dashboard to call the HTTP endpoints at `/api/cron/daily` and `/api/cron/weekly`.

### Slack Commands (Ad-Hoc Queries)

#### Team-Wide Views
| Command | What It Shows |
|---------|---------------|
| `@Stirlo tasks today` | All tasks due today (entire team) |
| `@Stirlo tasks week` | All tasks due this week (entire team) |
| `@Stirlo tasks overdue` or `@Stirlo overdue tasks` | All overdue tasks (entire team) |

#### Personal Views (Your Tasks Only)
| Command | What It Shows |
|---------|---------------|
| `@Stirlo my tasks today` or `@Stirlo my today` | Your tasks due today |
| `@Stirlo my tasks week` or `@Stirlo my week` | Your tasks due this week |

#### Manual Triggers (Admin)
| Command | What It Does |
|---------|--------------|
| `@Stirlo trigger daily` | Manually run the daily notification cycle |
| `@Stirlo trigger weekly` | Manually run the weekly notification cycle |

#### Help
| Command | What It Shows |
|---------|---------------|
| `@Stirlo tasks help` | Display all available task commands |

### Notification Channels
| Channel | Purpose |
|---------|---------|
| **#stirlo-assistant** | Team summaries (daily & weekly) |
| **#error-stirlo** | Error notifications if triggers fail |
| **Direct Messages** | Personal task lists sent to each assignee |

### Retry Logic (Robustness)
The monitoring system includes two layers of retry protection:

1. **API-Level Retries** (MondayClient):
   - 3 retries with exponential backoff (1s, 2s, 4s delays)
   - Handles timeouts, network errors, rate limits, and server errors (502, 503, 504, 429)

2. **Extraction-Level Retries** (Trigger Scripts):
   - If 0 tasks are returned, automatically retries up to 3 times
   - Distinguishes between "no tasks exist" vs "API failure returned empty"
   - 2s initial delay with 2x backoff multiplier

### Technical Implementation
- **Monday.com Client**: `src/monday/client.ts` - API calls with automatic retry
- **Task Monitor**: `src/services/taskMonitor.ts` - Task extraction and filtering
- **Daily Trigger**: `scripts/dailyTrigger.ts` - Scheduled daily notifications
- **Weekly Trigger**: `scripts/weeklyTrigger.ts` - Scheduled weekly notifications
- **Message Formatters**: `src/slack/messages/*.ts` - Block Kit message builders
- **Command Handler**: `src/slack/handlers/taskCommandHandler.ts` - Ad-hoc command processing