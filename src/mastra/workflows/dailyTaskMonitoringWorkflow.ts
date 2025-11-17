import { createWorkflow, createStep } from "../inngest";
import { z } from "zod";
import { mondayGetTasksByDateRangeTool } from "../tools/mondayTool";
import { slackPostMessageTool, slackFormatTaskListTool } from "../tools/slackTool";

const fetchTodayTasksStep = createStep({
  id: "fetch-today-tasks",
  description: "Fetch tasks due today from Monday.com",
  inputSchema: z.object({}),
  outputSchema: z.object({
    tasks: z.array(z.any()),
    totalTasks: z.number(),
    dateRange: z.string(),
  }),
  execute: async ({ mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔍 [Daily Monitor - Step 1] Fetching tasks due today');
    
    const result = await mondayGetTasksByDateRangeTool.execute({
      context: { dateRange: 'today' },
      mastra,
      runtimeContext,
    });
    
    logger?.info('✅ [Daily Monitor - Step 1] Tasks fetched', { 
      totalTasks: result.totalTasks 
    });
    
    return result;
  },
});

const fetchEndOfWeekTasksStep = createStep({
  id: "fetch-end-of-week-tasks",
  description: "Fetch tasks due at end of week (Friday) from Monday.com",
  inputSchema: z.object({
    todayPosted: z.boolean(),
    todayTaskCount: z.number(),
  }),
  outputSchema: z.object({
    tasks: z.array(z.any()),
    totalTasks: z.number(),
    dateRange: z.string(),
  }),
  execute: async ({ mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔍 [Daily Monitor - Step 2] Fetching end-of-week tasks');
    
    const result = await mondayGetTasksByDateRangeTool.execute({
      context: { dateRange: 'end-of-week' },
      mastra,
      runtimeContext,
    });
    
    logger?.info('✅ [Daily Monitor - Step 2] Tasks fetched', { 
      totalTasks: result.totalTasks 
    });
    
    return result;
  },
});

const formatAndPostTodayTasksStep = createStep({
  id: "format-and-post-today-tasks",
  description: "Format and post today's tasks to Slack",
  inputSchema: z.object({
    tasks: z.array(z.any()),
    totalTasks: z.number(),
    dateRange: z.string(),
  }),
  outputSchema: z.object({
    todayPosted: z.boolean(),
    todayTaskCount: z.number(),
  }),
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    logger?.info('💬 [Daily Monitor - Step 3] Formatting and posting today tasks', { 
      taskCount: inputData.totalTasks 
    });
    
    if (inputData.totalTasks === 0) {
      logger?.info('ℹ️ [Daily Monitor - Step 3] No tasks due today, skipping post');
      return { todayPosted: false, todayTaskCount: 0 };
    }
    
    // Format the task list
    const formatted = await slackFormatTaskListTool.execute({
      context: {
        tasks: inputData.tasks,
        title: '🚨 Tasks Due Today',
        dateRange: inputData.dateRange,
      },
      mastra,
      runtimeContext,
    });
    
    // Post to Slack
    await slackPostMessageTool.execute({
      context: {
        channel: 'stirlo-assistant',
        text: formatted.formattedText,
        blocks: formatted.blocks,
      },
      mastra,
      runtimeContext,
    });
    
    logger?.info('✅ [Daily Monitor - Step 3] Today tasks posted to Slack', { 
      taskCount: formatted.taskCount 
    });
    
    return { todayPosted: true, todayTaskCount: formatted.taskCount };
  },
});

const formatAndPostEndOfWeekTasksStep = createStep({
  id: "format-and-post-end-of-week-tasks",
  description: "Format and post end-of-week tasks to Slack",
  inputSchema: z.object({
    tasks: z.array(z.any()),
    totalTasks: z.number(),
    dateRange: z.string(),
  }),
  outputSchema: z.object({
    endOfWeekPosted: z.boolean(),
    endOfWeekTaskCount: z.number(),
  }),
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    logger?.info('💬 [Daily Monitor - Step 4] Formatting and posting end-of-week tasks', { 
      taskCount: inputData.totalTasks 
    });
    
    if (inputData.totalTasks === 0) {
      logger?.info('ℹ️ [Daily Monitor - Step 4] No tasks due end of week, skipping post');
      return { endOfWeekPosted: false, endOfWeekTaskCount: 0 };
    }
    
    // Format the task list
    const formatted = await slackFormatTaskListTool.execute({
      context: {
        tasks: inputData.tasks,
        title: '📌 Tasks Due End of Week',
        dateRange: inputData.dateRange,
      },
      mastra,
      runtimeContext,
    });
    
    // Post to Slack
    await slackPostMessageTool.execute({
      context: {
        channel: 'stirlo-assistant',
        text: formatted.formattedText,
        blocks: formatted.blocks,
      },
      mastra,
      runtimeContext,
    });
    
    logger?.info('✅ [Daily Monitor - Step 4] End-of-week tasks posted to Slack', { 
      taskCount: formatted.taskCount 
    });
    
    return { endOfWeekPosted: true, endOfWeekTaskCount: formatted.taskCount };
  },
});

export const dailyTaskMonitoringWorkflow = createWorkflow({
  id: "daily-task-monitoring",
  description: "Daily automated monitoring of Monday.com tasks due today and end-of-week",
  inputSchema: z.object({}),
})
  .then(fetchTodayTasksStep)
  .then(formatAndPostTodayTasksStep)
  .then(fetchEndOfWeekTasksStep)
  .then(formatAndPostEndOfWeekTasksStep)
  .commit();
