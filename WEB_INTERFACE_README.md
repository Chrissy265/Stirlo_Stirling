# Stirlo Web Chat Interface

## Overview

The Stirlo web chat interface provides a beautiful, user-friendly way to interact with your intelligent assistant through a web browser. It features user authentication, persistent conversation history, and seamless integration with the same AI agent that powers the Slack bot.

## Features

✨ **User Authentication**
- Secure signup and login with bcrypt password hashing
- Session-based authentication with HTTP-only cookies
- Automatic session management (7-day expiry)

💬 **Chat Interface**
- Beautiful, responsive React UI
- Real-time chat with the intelligent assistant
- Persistent conversation history per user
- Thread isolation (each user has their own conversation thread)

🧠 **AI Integration**
- Uses the same `intelligentAssistant` agent as the Slack bot
- Access to SharePoint search, Monday.com, and RAG tools
- Multi-step reasoning with `maxSteps: 5`
- Persistent memory across conversations

## Architecture

### Database Schema

**Users Table**
```sql
- id: serial primary key
- email: varchar (unique)
- password: varchar (bcrypt hashed)
- name: varchar
- created_at: timestamp
```

**Messages Table**
```sql
- id: serial primary key
- user_id: integer (foreign key to users)
- role: varchar ('user' or 'assistant')
- content: text
- created_at: timestamp
```

### Backend (Express Server)

**File**: `src/server/index.ts`
- Port: 5001
- API endpoints:
  - `POST /api/auth/signup` - Create new user account
  - `POST /api/auth/login` - Login existing user
  - `POST /api/auth/logout` - Logout and clear session
  - `GET /api/auth/me` - Get current user info
  - `GET /api/messages` - Get user's conversation history
  - `POST /api/chat` - Send message and get AI response

**Authentication**: `src/server/auth.ts`
- Password hashing with bcrypt
- User creation and retrieval

**Session Management**: `src/server/session.ts`
- In-memory session store
- 7-day session duration
- HTTP-only cookie-based authentication

### Frontend (React SPA)

**File**: `public/index.html`
- Single-page application with React (loaded via CDN)
- Responsive design with gradient theme
- Features:
  - Login/Signup forms with validation
  - Chat interface with message history
  - Typing indicators
  - Auto-scroll to latest messages
  - User avatars

## How to Start the Web Server

### Option 1: Direct Command
```bash
tsx src/server/index.ts
```

### Option 2: Using the startup script
```bash
chmod +x start-web-server.sh
./start-web-server.sh
```

The server will start on **http://0.0.0.0:5001**

## Usage

1. **Start the server**:
   ```bash
   tsx src/server/index.ts
   ```

2. **Open your browser** and navigate to:
   ```
   http://localhost:5001
   ```

3. **Create an account** by clicking "Sign up" and entering:
   - Your name
   - Email address
   - Password

4. **Start chatting** with Stirlo! Ask questions like:
   - "Search SharePoint for project documentation"
   - "What tasks do I have on Monday.com?"
   - "Tell me about our recent company updates"

## Integration with Intelligent Assistant

The web chat uses the same `intelligentAssistant` agent defined in `src/mastra/agents/intelligentAssistant.ts`, which includes:

- **SharePoint Search Tool**: Search across the entire Stirling Central organization
- **Monday.com Tool**: Access your workspace data
- **RAG Tool**: Semantic search using vector database
- **Memory**: Persistent conversation context using PostgreSQL storage

Each web user gets their own conversation thread (`web-user-{userId}`), ensuring conversations are isolated and history is preserved.

## Security Considerations

- ✅ Passwords are hashed with bcrypt (10 salt rounds)
- ✅ Sessions use HTTP-only cookies (not accessible via JavaScript)
- ✅ Session IDs are cryptographically random
- ✅ SQL injection protection via Drizzle ORM parameterized queries
- ⚠️  HTTPS should be enabled in production (currently HTTP only for local development)
- ⚠️  Sessions are stored in-memory (will be lost on server restart; consider Redis for production)

## API Examples

### Signup
```bash
curl -X POST http://localhost:5001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123","name":"John Doe"}'
```

### Login
```bash
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"user@example.com","password":"secure123"}'
```

### Send Chat Message
```bash
curl -X POST http://localhost:5001/api/chat \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"message":"Hello Stirlo!"}'
```

## File Structure

```
src/
├── server/
│   ├── index.ts        # Express server with API routes
│   ├── auth.ts         # Authentication functions
│   └── session.ts      # Session management
├── db/
│   ├── index.ts        # Database connection
│   └── schema.ts       # Drizzle schema (users, messages)
├── mastra/
│   └── agents/
│       └── intelligentAssistant.ts  # AI agent used by web chat
public/
└── index.html          # React frontend (single-page app)
start-web-server.sh     # Startup script
```

## Troubleshooting

**Server won't start:**
- Check if port 5001 is already in use: `lsof -i :5001`
- Kill existing process: `pkill -f "tsx src/server/index.ts"`

**Database connection errors:**
- Ensure PostgreSQL is running and DATABASE_URL is set
- Run migrations: `npm run db:push`

**Authentication issues:**
- Clear browser cookies
- Check server logs for errors
- Verify SESSION_SECRET environment variable is set

## Future Enhancements

- [ ] Add OAuth (Google, GitHub) for easier login
- [ ] Implement password reset via email
- [ ] Add real-time streaming responses (SSE or WebSockets)
- [ ] Deploy web interface alongside Slack bot
- [ ] Add conversation export/download
- [ ] Implement user profile management
- [ ] Add Redis for production session storage
- [ ] Enable HTTPS with SSL certificates
