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

### Task Monitoring Infrastructure (Phase 1-5 Complete)
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

**Key Files**:
- `src/utils/dateUtils.ts` - Australian timezone utilities with DST support
- `src/database/repositories/*.ts` - Database access layer
- `src/types/monitoring.ts` - TypeScript type definitions
- `src/services/taskMonitor.ts` - Central task fetching and filtering
- `src/slack/handlers/taskCommandParser.ts` - Command detection and parsing
- `src/slack/handlers/taskCommandHandler.ts` - Command execution and response formatting
- `src/slack/messages/*.ts` - Block Kit message formatters

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
  - `dailyTaskMonitoringWorkflow` - Scheduled task notifications (planned)
- **Integration**: `@mastra/inngest` adapter
- **Execution**: Multi-step execution with automatic retries and error handling

**Rationale**: Inngest provides durable execution with built-in retry logic, making it ideal for long-running agent workflows that may involve multiple API calls.

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