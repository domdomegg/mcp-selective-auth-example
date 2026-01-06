import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';
import { setupAuthServer } from '@modelcontextprotocol/sdk/examples/server/demoInMemoryOAuthProvider.js';
import { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';

const MCP_PORT = 3000;
const AUTH_PORT = 3001;

// Create a simple MCP server
const getServer = () => {
    const server = new McpServer(
        {
            name: 'mcp-selective-auth-example',
            version: '1.0.0',
        },
        { capabilities: {} }
    );

    // A simple tool that doesn't need auth to be listed, but needs auth to be called
    server.registerTool(
        'greet',
        {
            description: 'Greets someone by name',
            inputSchema: {
                name: z.string().describe('Name to greet')
            }
        },
        async ({ name }) => {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Hello, ${name}! (authenticated)`
                    }
                ]
            };
        }
    );

    server.registerTool(
        'secret',
        {
            description: 'Returns a secret message',
            inputSchema: {}
        },
        async () => {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'This is a secret message that requires authentication!'
                    }
                ]
            };
        }
    );

    return server;
};

const app = express();
app.use(express.json());

// Set up OAuth
const mcpServerUrl = new URL(`http://localhost:${MCP_PORT}/mcp`);
const authServerUrl = new URL(`http://localhost:${AUTH_PORT}`);

const oauthMetadata: OAuthMetadata = setupAuthServer({
    authServerUrl,
    mcpServerUrl,
    strictResource: true
});

const tokenVerifier = {
    verifyAccessToken: async (token: string) => {
        const endpoint = oauthMetadata.introspection_endpoint;

        if (!endpoint) {
            throw new Error('No token verification endpoint available');
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ token }).toString()
        });

        if (!response.ok) {
            throw new Error(`Invalid or expired token: ${await response.text()}`);
        }

        const data = await response.json();

        if (!data.aud) {
            throw new Error('Resource Indicator (RFC8707) missing');
        }
        if (!checkResourceAllowed({ requestedResource: data.aud, configuredResource: mcpServerUrl })) {
            throw new Error(`Expected resource indicator ${mcpServerUrl}, got: ${data.aud}`);
        }

        return {
            token,
            clientId: data.client_id,
            scopes: data.scope ? data.scope.split(' ') : [],
            expiresAt: data.exp
        };
    }
};

// Add OAuth metadata routes
app.use(
    mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: mcpServerUrl,
        scopesSupported: ['mcp:tools'],
        resourceName: 'Simple Auth Demo Server'
    })
);

// Create auth middleware
const authMiddleware = requireBearerAuth({
    verifier: tokenVerifier,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl)
});

// Conditional auth middleware - requires auth only for data-accessing operations
const selectiveAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Parse the JSON-RPC method from the request
    const method = req.body?.method;

    console.log(`Request method: ${method}`);

    // Methods that require authentication (actually access data)
    const authRequiredMethods = [
        'tools/call',
        'resources/read',
        'resources/subscribe',
        'prompts/get'
    ];

    if (authRequiredMethods.includes(method)) {
        console.log('  → Requiring auth');
        return authMiddleware(req, res, next);
    }

    // Allow everything else without auth (protocol negotiation, discovery, notifications)
    console.log('  → Allowing without auth');
    return next();
};

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// MCP POST endpoint with selective auth
app.post('/mcp', selectiveAuthMiddleware, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    console.log(`\nReceived MCP request: ${req.body?.method} (session: ${sessionId || 'new'})`);

    if (req.auth) {
        console.log('  Authenticated as:', req.auth.clientId);
    }

    try {
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
            // Reuse existing transport
            transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
            // New initialization request
            const eventStore = new InMemoryEventStore();
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                eventStore,
                onsessioninitialized: sessionId => {
                    console.log(`  Session initialized: ${sessionId}`);
                    transports[sessionId] = transport;
                }
            });

            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && transports[sid]) {
                    console.log(`  Session closed: ${sid}`);
                    delete transports[sid];
                }
            };

            const server = getServer();
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return;
        } else {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided'
                },
                id: null
            });
            return;
        }

        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error'
                },
                id: null
            });
        }
    }
});

// Start the server
app.listen(MCP_PORT, () => {
    console.log(`\n===========================================`);
    console.log(`MCP Server listening on port ${MCP_PORT}`);
    console.log(`OAuth Server listening on port ${AUTH_PORT}`);
    console.log(`===========================================\n`);
    console.log(`Auth pattern:`);
    console.log(`  ✓ initialize  - NO auth required`);
    console.log(`  ✓ tools/list  - NO auth required`);
    console.log(`  ✗ tools/call  - AUTH required`);
    console.log(`===========================================\n`);
});

process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    for (const sessionId in transports) {
        await transports[sessionId].close();
        delete transports[sessionId];
    }
    process.exit(0);
});
