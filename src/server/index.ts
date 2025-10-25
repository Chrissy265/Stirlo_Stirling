import express from 'express';
import cookieParser from 'cookie-parser';
import { createUser, getUserByEmail, getUserById, verifyPassword } from './auth.js';
import { createSession, deleteSession, requireAuth, getSession } from './session.js';
import { db } from '../db/index.js';
import { messages } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { intelligentAssistant } from '../mastra/agents/intelligentAssistant.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5001;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../../public')));

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const user = await createUser(email, password, name);
    const sessionId = createSession(user.id);
    
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }
    
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const sessionId = createSession(user.id);
    
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    deleteSession(sessionId);
  }
  res.clearCookie('sessionId');
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const sessionId = req.cookies.sessionId;
    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const session = getSession(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Session expired' });
    }
    
    const user = await getUserById(session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    
    const userMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(100);
    
    res.json(userMessages.reverse());
  } catch (error: any) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    await db.insert(messages).values({
      userId,
      role: 'user',
      content: message,
    });
    
    const threadId = `web-user-${userId}`;
    
    const { text } = await intelligentAssistant.generate(
      [{ role: 'user', content: message }],
      {
        resourceId: 'web-chat',
        threadId,
        maxSteps: 5,
      }
    );
    
    await db.insert(messages).values({
      userId,
      role: 'assistant',
      content: text,
    });
    
    res.json({
      role: 'assistant',
      content: text,
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  } else {
    next();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stirlo web interface running on http://0.0.0.0:${PORT}`);
});
