# Render Deployment Guide for SlackGenius

## Overview
This guide walks you through deploying SlackGenius to Render with the new keep-alive service that ensures your API stays responsive 24/7.

## What's New
✅ **Keep-Alive Service**: Automatically pings `/api/health` every 5 minutes to prevent your Render app from going idle
✅ **Production-Ready**: Optimized for paid Render tier with comprehensive logging and error handling
✅ **Dual-Interface Support**: Slack bot + Lovable web dashboard working from the same deployment

---

## Pre-Deployment Checklist

### 1. Production Build Complete
The `.mastra/output` directory contains your production-ready bundle. This includes:
- All compiled TypeScript code
- Optimized dependencies (751 packages)
- Keep-alive service with 5-minute interval pings
- Lovable API routes with CORS configuration

### 2. Environment Variables Required

You'll need to configure these environment variables in your Render service:

#### **Required Secrets** (from your Replit Secrets):
```
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
SHAREPOINT_CLIENT_ID=...
SHAREPOINT_CLIENT_SECRET=...
SHAREPOINT_TENANT_ID=...
MONDAY_API_KEY=...
SESSION_SECRET=...
```

#### **Render-Specific Variables** (add these new ones):
```
NODE_ENV=production
RENDER=true
RENDER_EXTERNAL_URL=https://stirlo-stirling.onrender.com
```

> **Note**: `RENDER_EXTERNAL_URL` should match your actual Render service URL. The keep-alive service uses this to ping itself.

---

## Deployment Steps

### Step 1: Push Your Code to GitHub
Since your Replit workspace is likely connected to GitHub, make sure your latest code (with keep-alive service) is pushed:

```bash
git add .
git commit -m "Add keep-alive service for Render deployment"
git push origin main
```

### Step 2: Create New Render Service

1. Go to your Render Dashboard: https://dashboard.render.com/
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure the service:

   **Basic Settings:**
   - **Name**: `stirlo-stirling` (or your preferred name)
   - **Region**: Choose closest to your users
   - **Branch**: `main` (or your deployment branch)
   - **Root Directory**: Leave blank (uses repository root)

   **Build & Deploy:**
   - **Build Command**: 
     ```bash
     npm install && npx mastra build
     ```
   - **Start Command**: 
     ```bash
     cd .mastra/output && NODE_ENV=production node --import=./instrumentation.mjs index.mjs
     ```

   **Environment:**
   - **Node Version**: Use default or specify `20.x`

### Step 3: Add Environment Variables

In the Render service settings, go to **"Environment"** tab and add all the variables listed above.

**Quick Copy Format** (replace with your actual values):
```
DATABASE_URL=<copy from Replit Secrets>
OPENAI_API_KEY=<copy from Replit Secrets>
SLACK_BOT_TOKEN=<copy from Replit Secrets>
SLACK_APP_TOKEN=<copy from Replit Secrets>
SLACK_SIGNING_SECRET=<copy from Replit Secrets>
SHAREPOINT_CLIENT_ID=<copy from Replit Secrets>
SHAREPOINT_CLIENT_SECRET=<copy from Replit Secrets>
SHAREPOINT_TENANT_ID=<copy from Replit Secrets>
MONDAY_API_KEY=<copy from Replit Secrets>
SESSION_SECRET=<copy from Replit Secrets>
NODE_ENV=production
RENDER=true
RENDER_EXTERNAL_URL=https://YOUR-SERVICE.onrender.com
```

> **Important**: Update `RENDER_EXTERNAL_URL` with your actual Render service URL after it's created.

### Step 4: Deploy!

Click **"Create Web Service"** and Render will:
1. Clone your repository
2. Run `npm install && npx mastra build`
3. Start your app with the configured start command
4. Assign you a public URL like `https://stirlo-stirling.onrender.com`

---

## Post-Deployment Verification

### 1. Check Deployment Logs
Monitor the Render logs (Live Logs tab) for these key messages:

✅ **Keep-Alive Activated**:
```
🔄 [Keep-Alive] Initializing service for Render deployment
🚀 [Keep-Alive] Service starting
🏓 [Keep-Alive] Pinging endpoint
✅ [Keep-Alive] Ping successful
```

✅ **Slack Connected**:
```
🔌 [Slack Socket Mode] Bot authenticated
🚀 [Slack Socket Mode] Socket Mode client started successfully
```

✅ **Mastra API Running**:
```
Mastra API running on port http://0.0.0.0:5000/api
```

### 2. Test API Endpoints

Once deployed, test your endpoints:

**Health Check:**
```bash
curl https://stirlo-stirling.onrender.com/api/health
```
Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-29T03:00:00.000Z",
  "service": "SlackGenius API",
  "agents": ["intelligentAssistant"],
  "workflows": ["slackIntelligentAssistantWorkflow"],
  "endpoints": [
    "POST /api/chat",
    "GET /api/history/:userId",
    "GET /api/conversation/:conversationId",
    "GET /api/health"
  ]
}
```

**Chat Endpoint (for Lovable):**
```bash
curl -X POST https://stirlo-stirling.onrender.com/api/chat \
  -H "Content-Type: application/json" \
  -H "Origin: https://stirlo-ai-assist.lovable.app" \
  -d '{
    "message": "Hello from Lovable!",
    "user_id": "test_user",
    "session_id": "test_session"
  }'
```

### 3. Monitor Keep-Alive Activity

Watch your Render logs for the next 15-20 minutes. You should see:
- Initial ping at startup
- Regular pings every 5 minutes
- Success confirmations with response times

Example log pattern:
```
03:00:00 | ✅ [Keep-Alive] Ping successful (responseTime: 120ms, pingNumber: 1, successRate: 100.0%)
03:05:00 | ✅ [Keep-Alive] Ping successful (responseTime: 115ms, pingNumber: 2, successRate: 100.0%)
03:10:00 | ✅ [Keep-Alive] Ping successful (responseTime: 118ms, pingNumber: 3, successRate: 100.0%)
```

---

## Integrating with Lovable

Once your Render deployment is live, update your Lovable frontend to use the new base URL:

### Update Lovable Configuration

In your Lovable project, update the API base URL to:
```
https://stirlo-stirling.onrender.com
```

The following endpoints are available:
- `POST /api/chat` - Send messages to the intelligent assistant
- `GET /api/history/:userId` - Get conversation history for a user
- `GET /api/conversation/:conversationId` - Get messages in a specific conversation
- `GET /api/health` - Health check endpoint

### CORS Configuration
Your Lovable domain (`https://stirlo-ai-assist.lovable.app`) is already allowlisted in the CORS configuration. Requests from Lovable will work automatically.

---

## Troubleshooting

### Keep-Alive Not Activating
**Symptom**: No keep-alive logs in Render
**Solution**: Verify `RENDER=true` is set in environment variables

### API Returns 404
**Symptom**: All API endpoints return "Not Found"
**Solution**: 
1. Check that start command includes `cd .mastra/output`
2. Verify build completed successfully
3. Ensure `NODE_ENV=production` is set

### Slack Bot Not Responding
**Symptom**: Slack messages don't trigger bot responses
**Solution**:
1. Check `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are correct
2. Verify Socket Mode is enabled in Slack App settings
3. Check Render logs for "Bot authenticated" message

### Database Connection Errors
**Symptom**: Errors about database connection in logs
**Solution**:
1. Verify `DATABASE_URL` is correct and accessible from Render
2. Check that your PostgreSQL database allows connections from Render's IP ranges
3. Ensure database is running and reachable

---

## Monitoring & Maintenance

### Key Metrics to Watch
1. **Keep-Alive Success Rate**: Should stay at 100% or very close
2. **Response Times**: Health endpoint should respond in <500ms
3. **Memory Usage**: Monitor in Render dashboard
4. **Error Logs**: Watch for any unexpected errors

### Recommended Alerts
Consider setting up Render notifications for:
- Deployment failures
- High error rates
- Service restarts
- Memory/CPU threshold exceeded

---

## Cost Optimization

With your **paid Render tier**, you have:
- ✅ Always-on instances (no cold starts)
- ✅ No sleep on inactivity
- ✅ Better performance
- ✅ Keep-alive pings work optimally

The 5-minute keep-alive interval is optimized for your tier and won't cause excessive API calls or costs.

---

## Next Steps

After successful deployment:

1. ✅ **Test Slack Integration**: Send a DM or mention to your bot
2. ✅ **Test Lovable Integration**: Make API calls from your web frontend
3. ✅ **Monitor Logs**: Watch for 24 hours to ensure stability
4. ✅ **Set Up Alerts**: Configure Render notifications
5. ✅ **Performance Test**: Verify response times under load

---

## Support Resources

- **Render Documentation**: https://render.com/docs
- **Mastra Documentation**: https://mastra.ai/docs
- **Slack API Documentation**: https://api.slack.com/

---

**Deployment URL**: `https://stirlo-stirling.onrender.com`

**Health Check**: `https://stirlo-stirling.onrender.com/api/health`

**Status**: ✅ Ready for deployment!
