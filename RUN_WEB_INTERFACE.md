# How to Run the Stirlo Web Interface

## Starting the Web Server

The web interface runs separately from the main Mastra application. Follow these steps:

### Method 1: Run in Shell (Recommended)

1. Open a new **Shell** tab in Replit
2. Run this command:
   ```bash
   tsx src/server/index.ts
   ```
3. You should see: `🚀 Stirlo web interface running on http://0.0.0.0:5001`
4. Keep this shell tab open (the server runs as long as the tab is open)

### Method 2: Run in Background

```bash
nohup tsx src/server/index.ts > /tmp/web-server.log 2>&1 &
```

To check if it's running:
```bash
tail -f /tmp/web-server.log
```

## Accessing the Web Interface

### Option 1: Through Replit Webview

1. After starting the server, look for the **Webview** panel in Replit
2. Change the port to **5001**
3. Or click "Open in new tab" with port 5001

### Option 2: Direct URL

Access at: `https://YOUR-REPL-URL:5001`

Where `YOUR-REPL-URL` is your Replit domain (shown in the Webview URL bar)

### Option 3: Port Forward

In Replit, you may need to configure port forwarding:
1. Click on "Webview" settings
2. Add port **5001** to exposed ports
3. Access the web interface through the generated URL

## Testing the Server

Once running, test it works:

```bash
curl http://localhost:5001
```

You should see HTML content starting with `<!DOCTYPE html>`

## Troubleshooting

**Server won't start:**
- Check if port 5001 is already in use
- Check logs: `cat /tmp/web-server.log`
- Kill existing process: `pkill -f "tsx src/server/index.ts"`

**Can't access through browser:**
- Make sure server is running (check logs)
- Verify you're using the correct Replit URL with port 5001
- Try refreshing the browser
- Clear browser cache/cookies

**Server stops when closing shell:**
- Use Method 2 (background process)
- Or keep the shell tab open

## Quick Start Guide

```bash
# Step 1: Start the server
tsx src/server/index.ts

# Step 2: Open browser to:
# https://YOUR-REPL-URL:5001

# Step 3: Create account and start chatting!
```

## Features Available

Once you access the web interface, you can:
- ✅ Sign up for a new account
- ✅ Log in securely
- ✅ Chat with Stirlo (same AI as Slack bot)
- ✅ Access SharePoint search
- ✅ Query Monday.com data
- ✅ View your conversation history
- ✅ Persistent memory across sessions

## Notes

- The web server runs on port **5001**
- The main Mastra app runs on port **5000**
- Both can run simultaneously
- Web chat has the same capabilities as the Slack bot
- Each user gets their own isolated conversation thread
- All conversations are saved to the database
