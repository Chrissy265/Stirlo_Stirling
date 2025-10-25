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
    
    console.log('📝 [Signup] New signup request:', { email, name });
    
    if (!email || !password || !name) {
      console.warn('⚠️  [Signup] Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (password.length < 8) {
      console.warn('⚠️  [Signup] Password too short');
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      console.warn('⚠️  [Signup] Email already registered:', email);
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const user = await createUser(email, password, name);
    console.log('✅ [Signup] User created:', { id: user.id, email: user.email });
    
    const sessionId = createSession(user.id);
    console.log('✅ [Signup] Session created for user:', user.id);
    
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error: any) {
    console.error('❌ [Signup] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('📝 [Login] Login attempt:', { email });
    
    if (!email || !password) {
      console.warn('⚠️  [Login] Missing credentials');
      return res.status(400).json({ error: 'Missing email or password' });
    }
    
    const user = await getUserByEmail(email);
    if (!user) {
      console.warn('⚠️  [Login] User not found:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      console.warn('⚠️  [Login] Invalid password for:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const sessionId = createSession(user.id);
    console.log('✅ [Login] Session created for user:', user.id);
    
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error: any) {
    console.error('❌ [Login] Error:', error);
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
      console.log('⚠️  [Auth] No session cookie');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const session = getSession(sessionId);
    if (!session) {
      console.warn('⚠️  [Auth] Session expired or invalid');
      return res.status(401).json({ error: 'Session expired' });
    }
    
    const user = await getUserById(session.userId);
    if (!user) {
      console.error('❌ [Auth] User not found for session:', session.userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('✅ [Auth] User authenticated:', { id: user.id, email: user.email });
    
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  } catch (error: any) {
    console.error('❌ [Auth] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    
    console.log('📖 [Messages] Fetching history for user:', userId);
    
    const userMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(100);
    
    console.log('✅ [Messages] Loaded messages:', { count: userMessages.length });
    
    res.json(userMessages.reverse());
  } catch (error: any) {
    console.error('❌ [Messages] Error:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { message } = req.body;
    
    console.log('💬 [Chat] New message from user:', { userId, messageLength: message?.length });
    
    if (!message || !message.trim()) {
      console.warn('⚠️  [Chat] Empty message');
      return res.status(400).json({ error: 'Message is required' });
    }
    
    await db.insert(messages).values({
      userId,
      role: 'user',
      content: message,
    });
    console.log('✅ [Chat] User message saved to DB');
    
    const threadId = `web-user-${userId}`;
    
    const recentMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = recentMessages
      .reverse()
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));
    
    console.log('📝 [Chat] Loaded conversation history:', { 
      messageCount: conversationHistory.length,
      threadId 
    });
    
    console.log('🤖 [Chat] Calling intelligent assistant...');
    const { text } = await intelligentAssistant.generate(
      conversationHistory as any,
      {
        resourceId: 'web-chat',
        threadId,
        maxSteps: 5,
      }
    );
    console.log('✅ [Chat] Got response from assistant:', { responseLength: text.length });
    
    await db.insert(messages).values({
      userId,
      role: 'assistant',
      content: text,
    });
    console.log('✅ [Chat] Assistant response saved to DB');
    
    res.json({
      role: 'assistant',
      content: text,
    });
  } catch (error: any) {
    console.error('❌ [Chat] Error:', error);
    res.status(500).json({ error: 'Failed to process message. Please try again.' });
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
