# SlackGenius Testing Guide

## 🎉 Your Bot is Live on Render!

**Deployment Status**: ✅ Successfully Connected
- **Bot ID**: B09QARV8M9A  
- **Platform**: Render (https://stirlo-stirling.onrender.com)
- **Socket Mode**: Active and connected
- **Database**: PostgreSQL with pgvector (Neon-backed)

---

## 🚀 Quick Start: Testing Your Slack Bot

### Step 1: Stop Replit Workflows (IMPORTANT)

Before testing, you **must** stop the Replit workflows to prevent conflicts:

1. In this Replit tab, find the running workflows panel
2. Click the **Stop button (⏹️)** for:
   - "Start application"
   - "Start inngest server"

> **Why?** Only ONE Socket Mode connection can be active at a time. If Replit workflows are running, they'll compete with Render and cause `invalid_auth` errors.

### Step 2: Test Basic Bot Response

1. Open your **Slack workspace** (Stirling Marketing)
2. Find the **Stirlo bot** in your apps/DMs
3. Send a simple message:
   ```
   Hello Stirlo!
   ```

**Expected Response**: The bot should respond within 2-3 seconds with an intelligent reply powered by GPT-5.

---

## 🧪 Testing Features

### Test 1: Monday.com Integration

**Message to send**:
```
What tasks are in my Monday.com board?
```

**What to check**:
- Bot should search Monday.com FIRST (as per mandatory search priority)
- Response should include actual task data from your Monday.com workspace
- Should see formatted task information

### Test 2: SharePoint Integration

**Message to send**:
```
Find documents about marketing strategy in SharePoint
```

**What to check**:
- Bot searches SharePoint/OneDrive
- Returns relevant documents with links
- Shows document metadata (title, author, last modified)

### Test 3: Semantic Search (RAG with pgvector)

**Message to send**:
```
What did we discuss about Q4 goals?
```

**What to check**:
- Bot searches conversation history using pgvector similarity search
- Retrieves relevant past conversations
- Provides context-aware responses

### Test 4: General Knowledge (External Search)

**Message to send**:
```
What's the latest news about AI in marketing?
```

**What to check**:
- Bot only searches external sources AFTER checking Monday.com and SharePoint
- Provides up-to-date information with sources

### Test 5: Memory Persistence

**Test conversation**:
```
User: My name is John and I work in marketing
Bot: [Response acknowledging]

User: What's my name?
Bot: [Should remember "John"]
```

**What to check**:
- Bot remembers information from earlier in the conversation
- Memory persists across messages in the same session

---

## 📊 Monitoring Your Bot

### Check Render Logs

1. Go to https://dashboard.render.com/
2. Select your `stirlo-stirling` service
3. Click **Logs** tab
4. Look for these indicators:

**✅ Healthy Bot Logs**:
```
🔌 [Slack Socket Mode] Bot authenticated
🚀 [Slack Socket Mode] Socket Mode client started successfully
✅ [Keep-Alive] Ping successful
```

**❌ Problem Indicators**:
```
[ERROR] invalid_auth         ← Wrong Slack tokens or Replit still running
❌ [Slack Socket Mode] Failed  ← Connection issue
```

### Real-Time Debugging

When you send a message to the bot, watch Render logs for:

```
📨 [Slack] Received message event
🔍 [Workflow] Processing message: "Your message here..."
🤖 [Agent] Generating response...
✅ [Slack] Response sent successfully
```

---

## 🌐 Web Dashboard (Lovable Integration)

Your bot also powers the web dashboard at: **https://stirlo-ai-assist.lovable.app**

### Test Web Interface

1. Open https://stirlo-ai-assist.lovable.app
2. The dashboard uses the same Mastra agent as Slack
3. Test chat functionality through the web UI
4. Verify shared memory between Slack and web

**Shared Features**:
- ✅ Same intelligent assistant agent
- ✅ Shared conversation memory (PostgreSQL)
- ✅ Same integrations (Monday.com, SharePoint)
- ✅ Same search priority rules

---

## 🔧 Troubleshooting

### Bot Not Responding

**Symptom**: Messages sent to bot, but no response

**Solutions**:
1. ✅ Check Replit workflows are **stopped**
2. ✅ Check Render logs for connection errors
3. ✅ Verify Socket Mode shows "started successfully"
4. ✅ Test health endpoint: `curl https://stirlo-stirling.onrender.com/api/health`

### Wrong Bot Responding

**Symptom**: Different bot responds or wrong name shows

**Solution**: 
- Verify Render environment variables use bot **B09QARV8M9A** tokens
- Check Render logs show `botId: "B09QARV8M9A"`

### Slow Responses

**Symptom**: Bot takes >10 seconds to respond

**Possible Causes**:
- Render free tier cold start (upgrade to paid tier recommended)
- Complex searches taking time (Monday.com + SharePoint + RAG)
- LLM API delays

**Check**: Look at Render logs for timing information:
```
⏱️ [Workflow] Step timing: XX ms
```

### Integration Not Working

**Symptom**: Can't access Monday.com or SharePoint data

**Solutions**:
1. Check environment variables in Render:
   - `MONDAY_API_KEY`
   - `SHAREPOINT_CLIENT_ID`
   - `SHAREPOINT_CLIENT_SECRET`
   - `SHAREPOINT_TENANT_ID`
2. Verify API keys are valid and not expired
3. Check integration permissions in respective platforms

---

## 🎯 Success Criteria

Your bot is working correctly when:

- ✅ Responds to messages within 2-5 seconds
- ✅ Searches Monday.com and SharePoint FIRST before external sources
- ✅ Remembers conversation context across messages
- ✅ Provides intelligent, context-aware responses
- ✅ Shows relevant data from integrated services
- ✅ Works consistently 24/7 without interruption
- ✅ Web dashboard and Slack bot share memory

---

## 📝 Next Steps

After successful testing:

1. **Deploy Update**: When you make code changes, push to GitHub and Render auto-deploys
2. **Monitor Usage**: Watch Render logs for the first 24 hours
3. **Team Rollout**: Introduce Stirlo to your Stirling Marketing team
4. **Feedback Loop**: Gather user feedback and iterate

---

## 🆘 Getting Help

If you encounter issues:

1. **Check Render Logs**: Most issues are visible in real-time logs
2. **Verify Environment Variables**: Ensure all secrets are correctly set
3. **Test Health Endpoint**: `https://stirlo-stirling.onrender.com/api/health`
4. **Review Documentation**: 
   - `RENDER_DEPLOYMENT.md` - Deployment details
   - `SLACK_APP_SETUP_GUIDE.md` - Slack configuration

---

## ⚡ Performance Tips

For best results:

1. **Use Render Paid Tier**: Eliminates cold starts, ensures 24/7 availability
2. **Keep Replit Stopped**: Only one Socket Mode connection allowed
3. **Monitor Keep-Alive**: Logs every 5 minutes keep Render responsive
4. **Database Optimization**: pgvector indexes speed up semantic search

---

**Ready to test!** 🚀

Stop Replit workflows, open Slack, and say hello to Stirlo!
