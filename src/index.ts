import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import { Job, JobSchedulerJson, Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { zodToJsonSchema } from "zod-to-json-schema";
import express, { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  Tool,
  ToolSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ToolName,
  GetDatetimeSchema,
  ScheduleMessageSchema,
  ListJobsSchema,
  CancelJobSchema,
} from "./tools/schemas.js";

console.error("Starting Streamable HTTP server...");

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.path === "/mcp" && req.method === "GET") {
    req.socket.setTimeout(0); // Disable socket timeout
    res.setTimeout(0); // Disable response timeout
  }
  next();
});
dotenv.config();

const { DEBUG = "true" } = process.env;

const debug = (...args: any[]) => {
  if (DEBUG?.toLowerCase() === "true" || DEBUG === "1") {
    console.error("[DEBUG]", ...args);
  }
};

// Store transports by session ID
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

// Queue and worker references
let messageQueue: Queue;
let messageWorker: Worker;

// Tool schemas and types
const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// Function to create a new MCP server instance
function createServer() {
  const server = new Server(
    {
      name: "simple-streamable-http-mcp-server",
      version: "1.0.0",
    },
    {
      instructions:
        "A simple test MCP server implemented with Streamable HTTP transport. Supports basic tools and long-running operations with progress updates.",
      capabilities: {
        tools: {},
      },
    }
  );

  if (!process.env.SCHEDULER_MCP_TOKEN) {
    throw new Error("SCHEDULER_MCP_TOKEN is not set");
  }

  // Set up the Redis connection
  let connection: any = {};

  if (process.env.REDIS_URL) {
    // Parse Redis URL (e.g., redis://user:pass@hostname:port)
    try {
      const url = new URL(process.env.REDIS_URL);
      connection = {
        host: url.hostname,
        port: url.port ? parseInt(url.port) : 6379,
      };

      // Add authentication if present in URL
      if (url.username) {
        connection.username = url.username;
      }
      if (url.password) {
        connection.password = url.password;
      }

      console.error(
        `Using Redis from REDIS_URL: ${url.hostname}:${connection.port}`
      );
    } catch (error) {
      console.error("Failed to parse REDIS_URL:", error);
      throw new Error("Invalid REDIS_URL format");
    }
  } else if (process.env.REDIS_HOST) {
    // Use separate host/port env vars
    connection = {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    };
    console.error(
      `Using Redis from REDIS_HOST: ${connection.host}:${connection.port}`
    );
  } else {
    throw new Error(
      "Either REDIS_URL or REDIS_HOST environment variable must be set"
    );
  }
  messageQueue = new Queue("messageQueue", {
    connection: {
      ...connection,
      retryStrategy: (times: number) => {
        if (times > 3) {
          console.error(`Redis connection failed after ${times} attempts`);
          return null; // Stop retrying
        }
        const delay = Math.min(times * 1000, 3000); // Max 3 second delay
        console.error(
          `Redis connection attempt ${times}, retrying in ${delay}ms`
        );
        return delay;
      },
    },
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: true,
    },
  });

  messageWorker = new Worker(
    "messageQueue",
    async (job) => {
      console.error(`Job started: ${job?.id}`);
      console.error(`Job data: ${JSON.stringify(job?.data, null, 2)}`);

      const librechatUrl = process.env.LIBRECHAT_BASE_URL;
      const ttgServiceApiKey = process.env.TTG_SERVICE_API_KEY;

      if (!librechatUrl) {
        throw new Error("LIBRECHAT_BASE_URL is not set");
      }
      if (!ttgServiceApiKey) {
        throw new Error("TTG_SERVICE_API_KEY is not set");
      }

      // POST to LibreChat API using axios
      try {
        const response = await axios.post(
          librechatUrl + "/api/service/convos/send",
          job?.data,
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": ttgServiceApiKey,
            },
            timeout: 30000,
            responseType: "stream",
          }
        );

        // Handle streaming response - always a stream since responseType is "stream"
        const isEventStream =
          response.headers["content-type"]?.includes("text/event-stream");

        if (isEventStream) {
          console.error("Handling SSE streaming response from LibreChat");
        } else {
          console.error("Handling standard response from LibreChat");
        }

        // Collect all data from the stream
        const chunks: Buffer[] = [];

        response.data.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          if (isEventStream) {
            const text = chunk.toString();
            console.error("SSE chunk:", text);
          }
        });

        // Wait for stream to complete
        await new Promise<void>((resolve, reject) => {
          response.data.on("end", () => {
            console.error("Stream ended successfully");

            if (!isEventStream && chunks.length > 0) {
              // For non-streaming responses, parse and log the complete data
              try {
                const fullData = Buffer.concat(chunks).toString();
                console.error("LibreChat response:", fullData);

                // Try to parse as JSON
                try {
                  const jsonData = JSON.parse(fullData);
                  console.error(
                    "Parsed JSON response:",
                    JSON.stringify(jsonData, null, 2)
                  );
                } catch {
                  // Not JSON, that's okay
                  console.error("Response is not JSON");
                }
              } catch (error) {
                console.error("Error processing response data:", error);
              }
            }

            resolve();
          });

          response.data.on("error", (error: Error) => {
            console.error("Stream error:", error);
            reject(error);
          });
        });

        console.error("LibreChat request completed successfully");
      } catch (error) {
        if (axios.isAxiosError(error)) {
          throw new Error(
            `Failed to POST to LibreChat API: ${
              error.response?.statusText || error.message
            }`
          );
        }
        throw error;
      }
    },
    {
      connection: {
        ...connection,
        retryStrategy: (times: number) => {
          if (times > 3) {
            console.error(`Redis connection failed after ${times} attempts`);
            return null; // Stop retrying
          }
          const delay = Math.min(times * 1000, 3000); // Max 3 second delay
          console.error(
            `Redis connection attempt ${times}, retrying in ${delay}ms`
          );
          return delay;
        },
      },
      removeOnFail: { count: 0 },
      removeOnComplete: { count: 0 },
    }
  );

  messageWorker.on("error", (err) => {
    console.error(err);
  });

  messageWorker.on("completed", (job: Job | undefined) => {
    console.error(`Job completed: ${job?.id}`);
  });

  messageWorker.on(
    "failed",
    (job: Job | undefined, error: Error, prev: string) => {
      console.error(`Job failed: ${job?.id}`, error, prev);
    }
  );

  // Set up the list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error("[TOOLS LIST] Listing available tools");
    const tools: Tool[] = [
      {
        name: ToolName.GET_DATETIME,
        description: "Get the current date and time in ISO 8601 format",
        inputSchema: zodToJsonSchema(GetDatetimeSchema) as ToolInput,
      },
      {
        name: ToolName.SCHEDULE_MESSAGE,
        description: "Schedule a message to be sent at a later time",
        inputSchema: zodToJsonSchema(ScheduleMessageSchema) as ToolInput,
      },
      {
        name: ToolName.LIST_JOBS,
        description: "List all jobs in the messageQueue",
        inputSchema: zodToJsonSchema(ListJobsSchema) as ToolInput,
      },
      {
        name: ToolName.CANCEL_JOB,
        description: "Cancel a job in the messageQueue",
        inputSchema: zodToJsonSchema(CancelJobSchema) as ToolInput,
      },
    ];

    return { tools };
  });

  // Set up the call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    console.error(
      `[TOOL CALL] Tool: ${name}, Args:`,
      JSON.stringify(args, null, 2)
    );
    debug(`Tool request details:`, JSON.stringify(request.params, null, 2));

    const token = extra.requestInfo?.headers?.["authorization"]
      ?.toString()
      .replace(/^Bearer\s+/i, "");

    if (token !== process.env.SCHEDULER_MCP_TOKEN) {
      throw new Error("Invalid token");
    }

    const userId = extra.requestInfo?.headers?.["x-user-id"];

    if (!userId) {
      throw new Error("User ID is required");
    }

    if (name === ToolName.GET_DATETIME) {
      debug(`get_datetime tool called`);
      return {
        content: [{ type: "text", text: new Date().toISOString() }],
      };
    }

    if (name === ToolName.SCHEDULE_MESSAGE) {
      const validatedArgs = ScheduleMessageSchema.parse(args);
      debug(`schedule_message tool called with args:`, validatedArgs);

      const {
        message,
        run_at_iso,
        delay_ms,
        conversation_id,
        is_temporary,
        repeat_every_ms,
      } = validatedArgs;

      // Check if user has reached max jobs limit
      const maxJobs = parseInt(process.env.MAX_JOBS || "3");
      const jobs = await messageQueue.getJobs();
      const jobSchedulers = await messageQueue.getJobSchedulers();
      const userJobs = jobs.filter((job) => job.data.user_id === userId);
      const userSchedulers = jobSchedulers.filter((scheduler) => {
        if (!scheduler.id) return false;
        const parts = scheduler.id.split("-");
        return parts.length >= 3 && parts[1] === userId;
      });
      const totalUserJobs = userJobs.length + userSchedulers.length;

      if (totalUserJobs >= maxJobs) {
        throw new Error(
          `Maximum number of scheduled jobs (${maxJobs}) reached. You currently have ${totalUserJobs} scheduled jobs. Please cancel some jobs before scheduling new ones.`
        );
      }

      // Message validation
      if (!message) {
        throw new Error("Message is required");
      }

      // Timing validation
      if (!run_at_iso && !delay_ms) {
        throw new Error("Run at ISO time or delay in milliseconds is required");
      }

      const effective_delay_ms = run_at_iso
        ? new Date(run_at_iso).getTime() - new Date().getTime()
        : delay_ms;

      if (!effective_delay_ms) {
        throw new Error("Failed to calculate effective delay in milliseconds");
      }
      if (effective_delay_ms < 0) {
        throw new Error("Run at ISO time is in the past");
      }

      // Agent ID validation
      const agent_id = process.env.AGENT_ID;
      if (!agent_id) {
        throw new Error("AGENT_ID environment variable is not set");
      }

      const jobData = {
        message,
        user_id: userId,
        conversation_id,
        is_temporary,
        agent_id,
        repeat_every_ms,
      };

      let job: Job;

      if (!repeat_every_ms) {
        job = await messageQueue.add("schedule_message", jobData, {
          delay: effective_delay_ms,
          removeOnComplete: true,
          removeOnFail: true,
        });
      } else {
        job = await messageQueue.upsertJobScheduler(
          "repeat_schedule_message-" + userId + "-" + randomUUID(),
          {
            every: repeat_every_ms,
            startDate: new Date(new Date().getTime() + effective_delay_ms),
          },
          {
            name: `${userId}`,
            data: jobData,
            opts: {
              removeOnComplete: true,
              removeOnFail: true,
            },
          }
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                queue: "messageQueue",
                jobId: job.id,
                name: "schedule_message",
                scheduledInMs: effective_delay_ms,
                runAt: new Date(
                  new Date().getTime() + effective_delay_ms
                ).toISOString(),
                repeating: repeat_every_ms !== undefined,
                repeatEveryMs: repeat_every_ms,
              },
              null,
              2
            ),
          },
        ],
      };
    }
    if (name === ToolName.LIST_JOBS) {
      const jobs = await messageQueue.getJobs();
      const jobSchedulers = await messageQueue.getJobSchedulers();
      const userJobs = jobs.filter((job) => job.data.user_id === userId);
      const userSchedulers = jobSchedulers.filter((scheduler) => {
        if (!scheduler.id) return false;
        const parts = scheduler.id.split("-");
        return parts.length >= 3 && parts[1] === userId;
      });
      return {
        content: [
          {
            type: "text",
            text:
              "User jobs: " +
              JSON.stringify(userJobs, null, 2) +
              "\nUser job schedulers: " +
              JSON.stringify(userSchedulers, null, 2),
          },
        ],
      };
    }
    if (name === ToolName.CANCEL_JOB) {
      const validatedArgs = CancelJobSchema.parse(args);
      const job = await messageQueue.getJob(validatedArgs.job_id);
      let removed = false;

      if (job) {
        // Check if job belongs to user
        if (job.data.user_id !== userId) {
          throw new Error(
            `Job ${validatedArgs.job_id} does not belong to user`
          );
        }

        // Check if it's a recurring job (has repeat options)
        if (job.opts.repeat) {
          const schedulerId = job.id;
          if (!schedulerId) {
            throw new Error("Cannot determine scheduler ID for recurring job");
          }
          console.error(`Removing scheduler for recurring job: ${schedulerId}`);
          removed = await messageQueue.removeJobScheduler(schedulerId);
        } else {
          // For regular one-time jobs, just remove the job
          removed = !!(await messageQueue.remove(validatedArgs.job_id));
        }
      } else {
        // Try to remove as scheduler if job not found
        console.error(
          `Job not found, trying to remove as scheduler: ${validatedArgs.job_id}`
        );

        // Check if scheduler ID belongs to user
        // Format: {prefix}-{userId}-{uuid}
        // The userId must be the first segment after the prefix
        const parts = validatedArgs.job_id.split("-");
        if (parts.length < 3 || parts[1] !== userId) {
          throw new Error(
            `Scheduler ${validatedArgs.job_id} does not belong to user`
          );
        }

        removed = await messageQueue.removeJobScheduler(validatedArgs.job_id);
      }

      return {
        content: [
          {
            type: "text",
            text: `Job ${validatedArgs.job_id} cancelled: ${removed}`,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return { server };
}

// Handle POST requests
app.post("/mcp", async (req: Request, res: Response) => {
  console.error("Received MCP POST request");
  console.error("Request method:", req.body?.method);
  debug("Headers:", JSON.stringify(req.headers, null, 2));
  debug("Body:", JSON.stringify(req.body, null, 2));

  try {
    // Check for existing session ID
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport
      transport = transports.get(sessionId)!;
      console.error(
        `[SESSION] Reusing existing transport for session ${sessionId}`
      );
    } else if (!sessionId) {
      // New initialization request
      console.error("[SESSION] Creating new server for initialization request");
      const { server } = createServer();

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sessionId: string) => {
          console.error(`Session initialized with ID: ${sessionId}`);
          transports.set(sessionId, transport);
        },
      });

      // Set up onclose handler to clean up transport when closed
      server.onclose = async () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          console.error(
            `Transport closed for session ${sid}, removing from transports map`
          );
          transports.delete(sid);
        }
      };

      // Connect the transport to the MCP server BEFORE handling the request
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return; // Already handled
    } else {
      // Invalid request - session ID provided but not found
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: Invalid session ID",
        },
        id: req?.body?.id,
      });
      return;
    }

    // Handle the request with existing transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: req?.body?.id,
      });
    }
  }
});

// Handle GET requests for SSE streams
app.get("/mcp", async (req: Request, res: Response) => {
  console.error("Received MCP GET request");
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
    return;
  }

  const lastEventId = req.headers["last-event-id"] as string | undefined;
  if (lastEventId) {
    console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
  } else {
    console.error(`Establishing new SSE stream for session ${sessionId}`);
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

  const transport = transports.get(sessionId)!;

  // Add keep-alive ping
  const keepAlive = setInterval(() => {
    if (!res.destroyed) {
      res.write(": ping\n\n");
    } else {
      clearInterval(keepAlive);
    }
  }, 30000); // Send ping every 30 seconds

  // Clean up on close
  req.on("close", () => {
    clearInterval(keepAlive);
    console.error(`SSE connection closed for session ${sessionId}`);
  });

  req.on("error", (error) => {
    clearInterval(keepAlive);
    console.error(`SSE connection error for session ${sessionId}:`, error);
  });

  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    clearInterval(keepAlive);
    console.error(
      `Error handling SSE request for session ${sessionId}:`,
      error
    );
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

// Handle DELETE requests for session termination
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
    return;
  }

  console.error(
    `Received session termination request for session ${sessionId}`
  );

  try {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Error handling session termination",
        },
        id: null,
      });
    }
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: {
      name: "simple-streamable-http-mcp-server",
      version: "1.0.0",
    },
    transport: "streamable-http",
    activeSessions: transports.size,
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.error(`MCP Streamable HTTP Server listening on port ${PORT}`);
  console.log(`📨 MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(
    `🛠️  Available tools: hello_world, get_server_info, long_running_test, slow_test`
  );
});

// Handle server shutdown
process.on("SIGINT", async () => {
  console.error("Shutting down server...");

  // Close all active transports
  for (const [sessionId, transport] of transports) {
    try {
      console.error(`Closing transport for session ${sessionId}`);
      await transport.close();
      transports.delete(sessionId);
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }

  // Close queue and worker
  try {
    await messageQueue?.close();
    await messageWorker?.close();
  } catch (error) {
    console.error(`Error closing queue/worker:`, error);
  }

  console.error("Server shutdown complete");
  process.exit(0);
});
