# Complete Slack App Setup Guide for SlackGenius
**For Non-Technical Users**

This guide will walk you through creating a Slack app from scratch with the exact settings needed for SlackGenius to work properly.

---

## Part 1: Create Your Slack App

### Step 1: Go to Slack API Website
1. Open your browser and go to: **https://api.slack.com/apps**
2. Click the green **"Create New App"** button

### Step 2: Choose App Creation Method
1. You'll see two options - click **"From scratch"**
2. Fill in the form:
   - **App Name**: Type `SlackGenius` (or any name you prefer)
   - **Pick a workspace**: Select your workspace from the dropdown (e.g., "Stirling Marketing")
3. Click **"Create App"**

---

## Part 2: Configure Basic Settings

### Step 3: Add App Icon (Optional)
1. On the left sidebar, click **"Basic Information"**
2. Scroll down to **"Display Information"**
3. Upload an icon for your app (optional but recommended)
4. Add a short description: "AI-powered assistant for Slack"
5. Click **"Save Changes"**

---

## Part 3: Enable Socket Mode (CRITICAL)

### Step 4: Turn On Socket Mode
1. On the left sidebar, scroll down and click **"Socket Mode"**
2. Toggle the switch to **"Enable Socket Mode"** (turn it ON)
3. A popup will appear asking you to generate a token:
   - **Token Name**: Type `Socket Mode Token`
   - Click **"Generate"**
4. **IMPORTANT**: Copy the token that appears (starts with `xapp-`)
   - Save this token somewhere safe - you'll need it later
   - This is your **SLACK_APP_TOKEN**
5. Click **"Done"**

---

## Part 4: Set Up Bot Permissions

### Step 5: Configure OAuth Scopes
1. On the left sidebar, click **"OAuth & Permissions"**
2. Scroll down to **"Scopes"** section
3. Under **"Bot Token Scopes"**, click **"Add an OAuth Scope"**
4. Add these scopes ONE BY ONE (type each name exactly):
   - `app_mentions:read` - Read messages that mention your bot
   - `channels:history` - View messages in public channels
   - `chat:write` - Send messages
   - `im:history` - View messages in direct messages
   - `im:write` - Send direct messages
   - `reactions:write` - Add emoji reactions

**Your final list should have exactly 6 scopes.**

---

## Part 5: Subscribe to Events

### Step 6: Configure Event Subscriptions
1. On the left sidebar, click **"Event Subscriptions"**
2. **IMPORTANT**: Make sure the toggle at the top is **OFF** (disabled)
   - We do NOT use Event Subscriptions with Socket Mode
   - If it's ON, turn it OFF

### Step 7: Enable Bot Events
1. On the same page, scroll down to **"Subscribe to bot events"**
2. Click **"Add Bot User Event"**
3. Add these events ONE BY ONE:
   - `app_mention` - When someone mentions your bot with @
   - `message.channels` - Messages in public channels
   - `message.im` - Messages in direct messages

**Your final list should have exactly 3 bot events.**

4. Click **"Save Changes"** at the bottom

---

## Part 6: Install App to Workspace

### Step 8: Install the App
1. On the left sidebar, click **"Install App"**
2. Click the green **"Install to Workspace"** button
3. Slack will show you what permissions the app needs - click **"Allow"**
4. **IMPORTANT**: After installation, you'll see a **"Bot User OAuth Token"**
   - Copy this token (starts with `xoxb-`)
   - Save this somewhere safe - you'll need it later
   - This is your **SLACK_BOT_TOKEN**

---

## Part 7: Get Your Signing Secret

### Step 9: Find Signing Secret
1. On the left sidebar, click **"Basic Information"**
2. Scroll down to **"App Credentials"**
3. Find **"Signing Secret"** and click **"Show"**
4. Copy the secret
5. Save this somewhere safe - you'll need it later
   - This is your **SLACK_SIGNING_SECRET**

---

## Part 8: Verify Your Configuration

### Step 10: Double-Check Settings
Go through this checklist to make sure everything is correct:

**Socket Mode:**
- ✅ Socket Mode is **ON** (enabled)
- ✅ You have saved your **xapp-** token

**OAuth & Permissions:**
- ✅ You have 6 bot scopes installed:
  - app_mentions:read
  - channels:history
  - chat:write
  - im:history
  - im:write
  - reactions:write
- ✅ You have saved your **xoxb-** token

**Event Subscriptions:**
- ✅ Event Subscriptions toggle is **OFF**
- ✅ You have 3 bot events:
  - app_mention
  - message.channels
  - message.im

**App Credentials:**
- ✅ You have saved your Signing Secret

---

## Part 9: What to Do with Your Tokens

You now have 3 important tokens:

1. **SLACK_BOT_TOKEN** (starts with `xoxb-`)
2. **SLACK_APP_TOKEN** (starts with `xapp-`)
3. **SLACK_SIGNING_SECRET** (random letters and numbers)

### Where to Add These Tokens:

**For Render Deployment:**
1. Go to your Render dashboard: https://dashboard.render.com/
2. Find your service (e.g., `stirlo-stirling`)
3. Click on **"Environment"** tab
4. Add or update these environment variables:
   - Key: `SLACK_BOT_TOKEN` → Value: [paste your xoxb- token]
   - Key: `SLACK_APP_TOKEN` → Value: [paste your xapp- token]
   - Key: `SLACK_SIGNING_SECRET` → Value: [paste your signing secret]
5. Click **"Save Changes"**

**Important**: Render will **automatically redeploy** your app when you save environment variables. You don't need to do anything else!

6. Wait for the redeploy to complete:
   - You'll see a yellow "Deploying" status at the top
   - After 1-2 minutes, it will change to green "Live"
   - Once it says "Live", your bot is ready to use with the new tokens

**For Replit (if testing locally):**
1. Go to your Replit workspace
2. Click the **"Secrets"** tab (lock icon on left sidebar)
3. Add or update these secrets:
   - Key: `SLACK_BOT_TOKEN` → Value: [paste your xoxb- token]
   - Key: `SLACK_APP_TOKEN` → Value: [paste your xapp- token]
   - Key: `SLACK_SIGNING_SECRET` → Value: [paste your signing secret]

---

## Part 10: Test Your Bot

### Step 11: Send a Test Message
1. Open your Slack workspace
2. Look for your bot in the **"Apps"** section
3. Click on it to open a direct message
4. Type: `Hello!`
5. The bot should respond within a few seconds

### If the Bot Doesn't Respond:
1. Make sure you've added all 3 tokens to Render
2. Check that Render has redeployed (shows "Live" status)
3. Wait 30 seconds and try again
4. If still not working, check the Render logs for errors

---

## Common Issues

### "The bot is not responding"
**Solution**: Make sure Socket Mode is enabled and you've copied the correct tokens.

### "I can't find Socket Mode in the sidebar"
**Solution**: Scroll down on the left sidebar - it's near the bottom, below "OAuth & Permissions".

### "My tokens don't start with xoxb- or xapp-"
**Solution**: You might be copying the wrong token. Go back to the correct section:
- Bot token (xoxb-) is in "Install App"
- App token (xapp-) is in "Socket Mode"

### "I need to use this in multiple workspaces"
**Solution**: You'll need to create a separate Slack app for each workspace. Each app will have its own set of tokens.

---

## Summary

You've successfully created a Slack app with:
- ✅ Socket Mode enabled
- ✅ Proper bot permissions
- ✅ Event subscriptions configured
- ✅ All tokens saved

Your SlackGenius bot is now ready to use! 🎉

---

## Need Help?

If you run into any issues:
1. Double-check that all 3 tokens are correctly added to Render
2. Verify Socket Mode is ON in your Slack app settings
3. Check the Render logs for error messages
4. Make sure the app is installed in your workspace

---

**Last Updated**: November 3, 2025
**App Name**: SlackGenius
**Configuration Type**: Socket Mode (recommended for production)
