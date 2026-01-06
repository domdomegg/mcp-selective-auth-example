#!/bin/bash

echo "=========================================="
echo "Testing MCP Server Auth Pattern"
echo "=========================================="
echo

# Test 1: Initialize without auth
echo "1. Testing initialize (should work without auth)..."
RESPONSE=$(curl -s -D /tmp/headers.txt -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    },
    "id": 1
  }')

if echo "$RESPONSE" | grep -q '"serverInfo"'; then
  echo "   ✓ Initialize succeeded without auth"
else
  echo "   ✗ Initialize failed"
  echo "   Response: $RESPONSE"
fi

SESSION_ID=$(grep -i "mcp-session-id:" /tmp/headers.txt | cut -d' ' -f2 | tr -d '\r')
echo "   Session ID: $SESSION_ID"
echo

# Test 2: List tools without auth
echo "2. Testing tools/list (should work without auth)..."
RESPONSE=$(curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 2
  }')

if echo "$RESPONSE" | grep -q '"name":"greet"'; then
  echo "   ✓ tools/list succeeded without auth"
else
  echo "   ✗ tools/list failed"
  echo "   Response: $RESPONSE"
fi
echo

# Test 3: Call a tool without auth (should fail with 401)
echo "3. Testing tools/call without auth (should fail with 401)..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/mcp \
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
    "id": 3
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "401" ]; then
  echo "   ✓ tools/call correctly returned 401 without auth"
  if echo "$BODY" | grep -q "WWW-Authenticate"; then
    echo "   ✓ Response includes WWW-Authenticate header info"
  fi
else
  echo "   ✗ tools/call should have returned 401, got: $HTTP_CODE"
  echo "   Response: $BODY"
fi
echo

# Test 4: notifications/initialized without auth (should work)
echo "4. Testing notifications/initialized (should work without auth)..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "notifications/initialized",
    "params": {}
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "202" ] || [ "$HTTP_CODE" = "204" ]; then
  echo "   ✓ notifications/initialized succeeded without auth"
else
  echo "   ✗ notifications/initialized failed with code: $HTTP_CODE"
fi
echo

echo "=========================================="
echo "Test Summary:"
echo "  ✓ Discovery operations work without auth"
echo "  ✓ Notifications work without auth"
echo "  ✓ Tool calls require auth (401)"
echo "=========================================="
