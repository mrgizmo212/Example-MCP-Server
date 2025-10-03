import z from "zod";

export enum ToolName {
  HELLO_WORLD = "hello_world",
  GET_SERVER_INFO = "get_server_info",
  LONG_RUNNING_TEST = "long_running_test",
  SLOW_TEST = "slow_test",
  GET_DATETIME = "get_datetime",
  SCHEDULE_MESSAGE = "schedule_message",
  LIST_JOBS = "list_jobs",
  CANCEL_JOB = "cancel_job",
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

export const GetDatetimeSchema = z.object({});

export const ScheduleMessageSchema = z.object({
  message: z.string().describe("The content to send in the message"),
  run_at_iso: z.string().describe("ISO-8601 timestamp to run at").optional(),
  delay_ms: z.number().describe("Delay in milliseconds from now").optional(),
  conversation_id: z.string().describe("Target conversation UUID").optional(),
  is_temporary: z
    .boolean()
    .describe("Mark conversation as temporary")
    .optional()
    .default(false),
  endpoint: z
    .string()
    .describe("Provider id (e.g., 'openAI', 'azureOpenAI')")
    .optional(),
  model: z
    .string()
    .describe("Model identifier for the chosen provider")
    .optional(),
  agent_id: z.string().describe("Optional agent identifier").optional(),
  repeat_every_ms: z
    .number()
    .describe("Recurring interval in milliseconds")
    .optional(),
});

export const ListJobsSchema = z.object({});

export const CancelJobSchema = z.object({
  job_id: z.string().describe("The ID of the job to cancel"),
});
