#!/usr/bin/env node

import http from 'http';

// Test configuration
const PORT = process.env.PORT || 3001;
const HOST = 'localhost';

let sessionId = null;

// Helper function to make HTTP requests
function makeRequest(method, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      // Capture session ID from response headers
      if (res.headers['mcp-session-id']) {
        sessionId = res.headers['mcp-session-id'];
        console.log(`📌 Session ID received: ${sessionId}`);
      }

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        console.log(`\n${method} ${path} - Status: ${res.statusCode}`);
        try {
          const parsedData = JSON.parse(responseData);
          console.log('Response:', JSON.stringify(parsedData, null, 2));
        } catch {
          console.log('Response:', responseData);
        }
        resolve({ status: res.statusCode, data: responseData, headers: res.headers });
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing MCP Streamable HTTP Server with Session Management...\n');

  // Test 1: Health check
  console.log('1️⃣ Testing health check...');
  await makeRequest('GET', '/health');

  // Test 2: Initialize request (should create new session)
  console.log('\n2️⃣ Testing initialize request (creating new session)...');
  const initResponse = await makeRequest('POST', '/mcp', {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    },
    id: 1
  });

  // Test 3: List tools (with session ID)
  console.log('\n3️⃣ Testing tools/list request (with session ID)...');
  await makeRequest('POST', '/mcp', {
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 2
  }, {
    'mcp-session-id': sessionId
  });

  // Test 4: Call a tool (with session ID)
  console.log('\n4️⃣ Testing tool call (hello_world) with session ID...');
  await makeRequest('POST', '/mcp', {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'hello_world',
      arguments: {
        name: 'Test User'
      }
    },
    id: 3
  }, {
    'mcp-session-id': sessionId
  });

  // Test 5: Try without session ID (should fail)
  console.log('\n5️⃣ Testing request without session ID (should fail)...');
  await makeRequest('POST', '/mcp', {
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 4
  });

  // Test 6: Test SSE stream endpoint
  console.log('\n6️⃣ Testing SSE stream endpoint...');
  await makeRequest('GET', '/mcp', null, {
    'mcp-session-id': sessionId
  });

  // Test 7: Terminate session
  console.log('\n7️⃣ Testing session termination...');
  await makeRequest('DELETE', '/mcp', null, {
    'mcp-session-id': sessionId
  });

  // Test 8: Try to use terminated session (should fail)
  console.log('\n8️⃣ Testing request with terminated session (should fail)...');
  await makeRequest('POST', '/mcp', {
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 5
  }, {
    'mcp-session-id': sessionId
  });

  console.log('\n✅ All tests completed!');
}

// Run tests
runTests().catch(console.error);
