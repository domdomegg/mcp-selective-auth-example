# Simple MCP Auth Server

A minimal MCP server demonstrating **selective authentication** - where some operations (like discovery) don't require auth, but tool execution does.

## Auth Pattern

- ✓ `initialize` - NO auth required
- ✓ `tools/list` - NO auth required
- ✗ `tools/call` - **AUTH required**

This lets clients discover available tools before committing to authentication, then requires OAuth when actually calling tools.

## How It Works

The server uses **conditional middleware** that inspects the JSON-RPC method:

```typescript
const selectiveAuthMiddleware = (req, res, next) => {
    const method = req.body?.method;

    // Allow discovery without auth
    if (method === 'initialize' || method === 'tools/list') {
        return next();
    }

    // Require auth for tool calls
    if (method === 'tools/call') {
        return authMiddleware(req, res, next);
    }

    return authMiddleware(req, res, next);
};
```

When a client tries to call a tool without auth:
1. Server returns `401 Unauthorized` with `WWW-Authenticate` header
2. Client discovers OAuth metadata from the header
3. Client initiates OAuth 2.1 flow with PKCE
4. Client retries with `Authorization: Bearer <token>`

## Setup

```bash
npm install
```

## Run

```bash
npm start
```

This starts:
- MCP server on port **3000**
- OAuth server on port **3001**

## Testing

You can test with `mcp-cli` or any MCP client. The flow will be:

1. Initialize (works without auth)
2. List tools (works without auth)
3. Call tool (requires OAuth flow)

## Files

- `server.ts` - Main server with selective auth middleware
- `package.json` - Dependencies (uses local typescript-sdk)
