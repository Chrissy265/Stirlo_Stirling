#!/bin/bash

# Kill any existing server
pkill -f "tsx src/server/index.ts" 2>/dev/null || true
sleep 1

# Start the web server
echo "🚀 Starting Stirlo web interface..."
tsx src/server/index.ts &

echo "Web server started. Access it at http://localhost:5001"
