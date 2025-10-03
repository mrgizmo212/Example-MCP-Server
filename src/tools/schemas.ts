import z from "zod";

export enum ToolName {
  GET_DATETIME = "get_datetime",
  SCHEDULE_MESSAGE = "schedule_message",
  LIST_JOBS = "list_jobs",
  CANCEL_JOB = "cancel_job",
}

// Define tool schemas
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
    .default(
      process.env.DEFAULT_TEMP?.toLowerCase() === "false" ? false : true
    ),
  repeat_every_ms: z
    .number()
    .describe("Recurring interval in milliseconds")
    .optional(),
});

export const ListJobsSchema = z.object({});

export const CancelJobSchema = z.object({
  job_id: z.string().describe("The ID of the job to cancel"),
});
