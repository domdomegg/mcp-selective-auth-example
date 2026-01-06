#!/bin/bash

# Initialize to get session
RESPONSE=$(curl -s -D /tmp/test-headers.txt -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    },
    "id": 1
  }')

SESSION_ID=$(grep -i "mcp-session-id:" /tmp/test-headers.txt | cut -d' ' -f2 | tr -d '\r')
echo "Session ID: $SESSION_ID"
echo

# Test tools/call without auth
echo "Testing tools/call without auth..."
curl -i -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "greet",
      "arguments": {"name": "World"}
    },
    "id": 2
  }' 2>&1
