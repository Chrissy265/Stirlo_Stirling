# Stirlo Slack Bot Setup Guide

## Overview

Your Stirlo Intelligent Assistant is now connected to Slack using **Socket Mode**! The bot maintains a persistent WebSocket connection to Slack, eliminating the need for webhook configuration. It uses the same AI agent that powers the web interface, giving Slack users access to SharePoint search, Monday.com integration, and RAG-powered conversation history.

## What's Configured

✅ **Socket Mode Connection**
- Persistent WebSocket connection to Slack
- No webhook URLs needed
- Works behind firewalls
- Real-time event delivery

✅ **Slack Workflow** (`slackIntelligentAssistantWorkflow`)
- Step 1: Calls the intelligent assistant with user messages
- Step 2: Sends natural, human-like responses back to Slack
- Automatically strips markdown formatting (no asterisks or bold text)
- Clean, conversational replies

✅ **Message Handling**
- Responds to direct messages (DMs)
- Responds when @mentioned in channels
- Adds ⏳ hourglass reaction while processing
- Removes hourglass when response is sent
- Ignores other channel messages (no spam)

✅ **Integration**
- SharePoint search across Stirling Central organization
- Monday.com task and project queries
- RAG semantic search over past conversations
- Persistent memory using PostgreSQL

## Slack App Configuration (Socket Mode)

Your Slack app must be configured with Socket Mode enabled. If you haven't done this yet:

### 1. Enable Socket Mode

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Select your **Stirlo** app
3. Click **Socket Mode** in the left sidebar (under "Settings")
4. Toggle **Enable Socket Mode** to ON
5. Click **Save Changes**

### 2. Generate App-Level Token

Socket Mode requires an app-level token (different from your bot token):

1. In Socket Mode settings, find "App-Level Tokens"
2. Click **Generate Token and Scopes**
3. Give it a name like "Stirlo Socket Token"
4. Add the scope: `connections:write`
5. Click **Generate**
6. Copy the token (starts with `xapp-`) - this is your `SLACK_APP_TOKEN`

### 3. Disable Event Subscriptions (Webhooks)

Since you're using Socket Mode, webhooks are not needed:

1. Click **Event Subscriptions** in the left sidebar
2. Toggle **Enable Events** to OFF
3. Click **Save Changes**

### 4. Required Secrets

Your app needs these three environment secrets:

- `SLACK_BOT_TOKEN` - Bot user OAuth token (starts with `xoxb-`)
- `SLACK_SIGNING_SECRET` - Signing secret for request verification
- `SLACK_APP_TOKEN` - App-level token for Socket Mode (starts with `xapp-`)

All three should already be configured in your Replit Secrets.

### 5. Subscribe to Bot Events

Even with Socket Mode, you need to subscribe to the events your bot will receive:

1. Go to **Event Subscriptions** in the Slack app settings
2. Scroll down to "Subscribe to bot events"
3. Make sure these events are enabled:
   - `message.channels` - Messages in channels
   - `message.im` - Direct messages
   - `app_mention` - When the bot is @mentioned
4. Click **Save Changes**
5. **Reinstall the app** to your workspace if prompted

## Testing Your Bot

### Option 1: Test in Playground (Recommended First)

1. Open the **Playground** tab in Replit
2. Select the `slackIntelligentAssistantWorkflow`
3. Send a test message like:
   ```json
   {
     "message": "Search SharePoint for project documentation",
     "threadId": "test-thread-123",
     "channel": "C0123456789",
     "messageTs": "1234567890.123456"
   }
   ```
4. Verify the agent responds correctly

### Option 2: Test in Your Slack Workspace

1. **Check Socket Mode Connection:**
   - Look for this in your Replit logs:
     ```
     🔌 [Slack Socket Mode] Bot authenticated
     🚀 [Slack Socket Mode] Socket Mode client started successfully
     ```
   - If you see these logs, Socket Mode is connected!

2. **Send a direct message:**
   - Open a DM with your bot
   - Type: "Hello! Can you search SharePoint for quarterly reports?"
   - The bot should add a ⏳ reaction and then respond

3. **Mention in a channel:**
   - Invite the bot to a channel: `/invite @YourBotName`
   - Type: "@YourBotName what tasks do I have on Monday.com?"
   - The bot will respond

## Response Format

The bot sends **clean, natural responses** that look like a human wrote them:

**❌ Before (with markdown):**
```
**Here are your tasks:**
- *Design review* - Due tomorrow
- **Code review** - Due Friday
```

**✅ After (clean and natural):**
```
Here are your tasks:
• Design review - Due tomorrow
• Code review - Due Friday
```

## Bot Behavior

### Will Respond To:
- ✅ Direct messages (DMs)
- ✅ @mentions in channels
- ✅ Threaded replies

### Will NOT Respond To:
- ❌ Regular channel messages (without @mention)
- ❌ Messages from other bots
- ❌ Reactions or file uploads

### Reactions:
- ⏳ Hourglass: Bot is thinking/processing
- Reaction is automatically removed when response is sent

## Available Capabilities

Your Slack bot can:

1. **Search SharePoint**
   - "Find the Q3 financial report"
   - "Search for documents about project Alpha"
   - "Show me files from the marketing team"

2. **Query Monday.com**
   - "What are my upcoming deadlines?"
   - "Show me tasks for project Beta"
   - "What's the status of the design board?"

3. **Search Conversation History**
   - "Do you remember when we discussed the budget?"
   - "What did John say about the timeline?"
   - "Find our previous conversation about pricing"

4. **General Questions**
   - The bot can answer questions, provide summaries, and assist with various tasks
   - It maintains conversation context across messages

## Publishing/Deploying

To make your bot live and accessible in your Slack workspace:

1. **Ensure Socket Mode is enabled** in your Slack app (see above)
2. **Verify all secrets are set** (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`)
3. Click the **Publish** button in Replit
4. Follow the deployment wizard
5. Your bot will automatically connect via Socket Mode - no webhook configuration needed!

**Note:** Changes to the bot code will NOT be reflected in Slack until you republish/redeploy.

## Monitoring & Logs

All bot interactions are logged with detailed information:

### Socket Mode Connection:
- `🔌 [Slack Socket Mode] Initializing Socket Mode connection` - Starting up
- `🔌 [Slack Socket Mode] Bot authenticated` - Successfully authenticated with Slack
- `🚀 [Slack Socket Mode] Socket Mode client started successfully` - Connection established
- `✅ [Slack Socket Mode] Connected and ready` - Ready to receive messages

### Message Handling:
- `📝 [Slack Socket Mode] Received message event` - Incoming message
- `📝 [Slack Socket Mode] Processing event` - Handling the message
- `📝 [Slack Socket Mode] Handler completed` - Workflow finished
- `📝 [Slack Trigger]` - Workflow trigger logged

### Errors:
- `❌ [Slack Socket Mode] Error processing event` - Event handling error
- `❌ [Slack Socket Mode] Socket error` - Connection error
- `⚠️ [Slack Socket Mode] Disconnected from Slack` - Connection lost (will auto-reconnect)

Check the workflow logs in Replit to debug any issues.

## Troubleshooting

### Socket Mode not connecting
- Verify `SLACK_APP_TOKEN` is set in Replit Secrets
- Check that Socket Mode is enabled in your Slack app
- Ensure the app-level token has `connections:write` scope
- Look for connection errors in the logs

### Bot doesn't respond to messages
- Verify `SLACK_BOT_TOKEN` is set
- Check that the bot is invited to the channel
- Ensure bot events are subscribed: `message.channels`, `message.im`, `app_mention`
- Look for errors in the workflow logs
- Verify the Mastra server is running

### "SLACK_APP_TOKEN not found" error
- You need to generate an app-level token in Slack
- Go to Socket Mode settings → Generate Token
- Add the scope `connections:write`
- Copy the token to Replit Secrets as `SLACK_APP_TOKEN`

### Bot responds with raw markdown
- This shouldn't happen - the workflow strips markdown
- If you see asterisks or formatting symbols, check the logs

### Hourglass reaction stays forever
- The workflow should remove it automatically
- Check for errors in Step 2 of the workflow logs

### Bot responds to every message
- The handler is configured to only respond to DMs and @mentions
- If it's responding to everything, check src/mastra/index.ts Socket Mode handler logic

### Socket Mode keeps disconnecting
- This is normal - Socket Mode will automatically reconnect
- Look for "Connected and ready" log messages
- If it never reconnects, check your `SLACK_APP_TOKEN`

## Files Reference

- **Socket Mode Initialization**: `src/mastra/index.ts` (initializeSocketMode call at bottom)
- **Socket Mode Handler**: `src/triggers/slackTriggers.ts` (initializeSocketMode function)
- **Workflow**: `src/mastra/workflows/slackIntelligentAssistantWorkflow.ts`
- **Agent**: `src/mastra/agents/intelligentAssistant.ts`
- **Tools**: `src/mastra/tools/` (SharePoint, Monday, RAG)

## Next Steps

1. Test the bot in your Slack workspace
2. Adjust the system prompt in `intelligentAssistant.ts` if needed
3. Add more tools or capabilities as required
4. Publish/deploy when you're satisfied with the behavior

## Support

If you encounter issues:
1. Check the workflow logs in Replit for Socket Mode connection status
2. Verify all environment variables are set (especially `SLACK_APP_TOKEN`)
3. Test in the Playground first before testing in Slack
4. Ensure Socket Mode is enabled in your Slack app settings
5. Make sure you've published/deployed after making code changes

---

**Your Stirlo bot is ready to assist your team in Slack via Socket Mode! 🎉**
