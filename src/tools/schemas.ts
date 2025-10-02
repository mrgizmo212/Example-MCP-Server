import z from "zod";

export enum ToolName {
  HELLO_WORLD = "hello_world",
  GET_SERVER_INFO = "get_server_info",
  LONG_RUNNING_TEST = "long_running_test",
  SLOW_TEST = "slow_test",
}

// Define tool schemas
export const HelloWorldSchema = z.object({
  name: z.string().describe("The name to greet"),
});

export const GetServerInfoSchema = z.object({});

export const LongRunningTestSchema = z.object({
  duration: z
    .number()
    .optional()
    .default(30)
    .describe("Duration in seconds (default: 30)"),
  steps: z
    .number()
    .optional()
    .default(10)
    .describe("Number of progress steps (default: 10)"),
  message: z
    .string()
    .optional()
    .describe("Optional message to include in the response"),
});

export const SlowTestSchema = z.object({
  message: z
    .string()
    .optional()
    .describe("Optional message to include in the response"),
  steps: z
    .number()
    .optional()
    .default(20)
    .describe("Number of progress steps (default: 20)"),
});
