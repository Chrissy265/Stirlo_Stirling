# Stirlo Slack Bot Setup Guide

## Overview

Your Stirlo Intelligent Assistant is now connected to Slack! The bot uses the same AI agent that powers the web interface, giving Slack users access to SharePoint search, Monday.com integration, and RAG-powered conversation history.

## What's Configured

✅ **Slack Workflow** (`slackIntelligentAssistantWorkflow`)
- Step 1: Calls the intelligent assistant with user messages
- Step 2: Sends natural, human-like responses back to Slack
- Automatically strips markdown formatting (no asterisks or bold text)
- Clean, conversational replies

✅ **Slack Trigger**
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

1. **Add the bot to a channel:**
   - Go to your Slack workspace
   - Find your app/bot
   - Invite it to a test channel: `/invite @YourBotName`

2. **Send a direct message:**
   - Open a DM with your bot
   - Type: "Hello! Can you search SharePoint for quarterly reports?"
   - The bot should add a ⏳ reaction and then respond

3. **Mention in a channel:**
   - In any channel where the bot is present
   - Type: "@YourBotName what tasks do I have on Monday.com?"
   - The bot will respond in a thread

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

1. Click the **Publish** button in Replit
2. Follow the deployment wizard
3. Connect your Slack app credentials during deployment
4. Your bot will be live!

**Note:** Changes to the bot code will NOT be reflected in Slack until you republish/redeploy.

## Monitoring & Logs

All bot interactions are logged with detailed information:

- `📝 [Slack Trigger]` - Incoming message received
- `🤖 [Slack Workflow] Step 1` - Calling the intelligent assistant
- `✅ [Slack Workflow] Step 1` - Got response from assistant
- `💬 [Slack Workflow] Step 2` - Sending reply to Slack
- `⏳ [Slack Workflow]` - Reaction management
- `✅ [Slack Workflow] Step 2` - Reply sent successfully

Check the workflow logs in Replit to debug any issues.

## Troubleshooting

### Bot doesn't respond
- Verify SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET are set
- Check that the bot is invited to the channel
- Look for errors in the workflow logs
- Ensure the Mastra server is running

### Bot responds with raw markdown
- This shouldn't happen - the workflow strips markdown
- If you see asterisks or formatting symbols, check the logs

### Hourglass reaction stays forever
- The workflow should remove it automatically
- Check for errors in Step 2 of the workflow logs

### Bot responds to every message
- The trigger is configured to only respond to DMs and @mentions
- If it's responding to everything, check src/mastra/index.ts trigger logic

## Files Reference

- **Workflow**: `src/mastra/workflows/slackIntelligentAssistantWorkflow.ts`
- **Trigger**: `src/mastra/index.ts` (registerSlackTrigger section)
- **Agent**: `src/mastra/agents/intelligentAssistant.ts`
- **Tools**: `src/mastra/tools/` (SharePoint, Monday, RAG)

## Next Steps

1. Test the bot in your Slack workspace
2. Adjust the system prompt in `intelligentAssistant.ts` if needed
3. Add more tools or capabilities as required
4. Publish/deploy when you're satisfied with the behavior

## Support

If you encounter issues:
1. Check the workflow logs in Replit
2. Verify all environment variables are set
3. Test in the Playground first before testing in Slack
4. Ensure you've published/deployed after making code changes

---

**Your Stirlo bot is ready to assist your team in Slack! 🎉**
