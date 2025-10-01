# Simple Streamable HTTP MCP Server

A clean implementation of an MCP server using the Streamable HTTP transport, following the official MCP patterns.

## Features

- **Streamable HTTP Transport**: Supports both JSON responses and Server-Sent Events (SSE)
- **Session Management**: Proper session handling with unique session IDs
- **Progress Notifications**: Long-running tools send progress updates
- **Multiple Tools**:
  - `hello_world`: Simple greeting tool
  - `get_server_info`: Returns server information
  - `long_running_test`: Configurable duration test with progress (default: 30s)
  - `slow_test`: 10-minute test with progress updates

## Architecture

This server follows the MCP team's recommended patterns:

1. **Session-based Architecture**: Each client gets a unique session ID
2. **Transport Reuse**: Transports are stored and reused for subsequent requests
3. **Proper Initialization**: New sessions are created only on initialization requests
4. **Clean Shutdown**: All transports are properly closed on server shutdown

## Running the Server

```bash
# Install dependencies
npm ci

# Run the server (default port: 3001, DEBUG logging enabled by default)
npm run start

# Run without debug logging, or edit `.env` to set DEBUG=false
DEBUG=false npm run start

# Run in development mode (auto-reload)
npm run dev
```

## Testing

Use the provided test script to verify the server is working correctly:

```bash
npm run test:http
```

This will test:
- Session initialization
- Tool listing and calling
- Session ID management
- SSE streaming
- Session termination

## Progress Notifications

The `long_running_test` and `slow_test` tools demonstrate progress notifications:

```javascript
// Example tool call with progress
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "long_running_test",
    "arguments": {
      "duration": 60,
      "steps": 12,
      "message": "Testing progress notifications"
    },
    "_meta": {
      "progressToken": "unique-progress-token"
    }
  },
  "id": 1
}
```

The server will send progress notifications:
```javascript
{
  "method": "notifications/progress",
  "params": {
    "progress": 1,
    "total": 12,
    "progressToken": "unique-progress-token"
  }
}
```

## Key Differences from Basic Examples

1. **Proper Session Management**: Sessions are created per client, not per request
2. **Transport Lifecycle**: Transports persist across requests within a session
3. **Error Handling**: Comprehensive error handling for all edge cases
4. **Progress Support**: Long-running operations can report progress
5. **Clean Architecture**: Clear separation between server creation and request handling

## Environment Variables

- `PORT`: Server port (default: 3001)
- `DEBUG`: Enable debug logging (`true` by default)

## Endpoints

- `POST /mcp`: Handle JSON-RPC requests
- `GET /mcp`: Handle SSE streaming
- `DELETE /mcp`: Terminate sessions
- `GET /health`: Health check endpoint
