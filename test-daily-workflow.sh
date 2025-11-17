#!/bin/bash

echo "🧪 Testing Daily Task Monitoring Workflow"
echo "=========================================="
echo ""
echo "Triggering workflow via API..."
echo ""

curl -X POST http://localhost:5000/api/workflows/daily-task-monitoring/run \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w "\n\nHTTP Status: %{http_code}\n"

echo ""
echo "✅ Workflow triggered! Check #stirlo-assistant channel in Slack for results."
