import { createWorkflow, createStep } from "../inngest";
import { z } from "zod";
import { mondayGetTasksByDateRangeTool } from "../tools/mondayTool";
import { slackPostMessageTool, slackFormatTaskListTool } from "../tools/slackTool";

const fetchUpcomingWeekTasksStep = createStep({
  id: "fetch-upcoming-week-tasks",
  description: "Fetch tasks due in the upcoming week from Monday.com",
  inputSchema: z.object({}),
  outputSchema: z.object({
    tasks: z.array(z.any()),
    totalTasks: z.number(),
    dateRange: z.string(),
  }),
  execute: async ({ mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    logger?.info('🔍 [Weekly Monitor - Step 1] Fetching upcoming week tasks');
    
    const result = await mondayGetTasksByDateRangeTool.execute({
      context: { dateRange: 'upcoming-week' },
      mastra,
      runtimeContext,
    });
    
    logger?.info('✅ [Weekly Monitor - Step 1] Tasks fetched', { 
      totalTasks: result.totalTasks 
    });
    
    return result;
  },
});

const formatAndPostWeeklyTasksStep = createStep({
  id: "format-and-post-weekly-tasks",
  description: "Format and post upcoming week tasks to Slack",
  inputSchema: z.object({
    tasks: z.array(z.any()),
    totalTasks: z.number(),
    dateRange: z.string(),
  }),
  outputSchema: z.object({
    posted: z.boolean(),
    taskCount: z.number(),
  }),
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    logger?.info('💬 [Weekly Monitor - Step 2] Formatting and posting weekly overview', { 
      taskCount: inputData.totalTasks 
    });
    
    if (inputData.totalTasks === 0) {
      // Even if no tasks, post a positive message
      const emptyMessage = `✅ *📅 Weekly Task Overview*\n\n_Upcoming Week (Next 7 Days)_\n\nGreat news! No tasks with deadlines in the upcoming week. Enjoy the calm before the storm! 🌴`;
      
      await slackPostMessageTool.execute({
        context: {
          channel: 'stirlo-assistant',
          text: emptyMessage,
        },
        mastra,
        runtimeContext,
      });
      
      logger?.info('ℹ️ [Weekly Monitor - Step 2] No upcoming tasks, posted empty state message');
      return { posted: true, taskCount: 0 };
    }
    
    // Format the task list
    const formatted = await slackFormatTaskListTool.execute({
      context: {
        tasks: inputData.tasks,
        title: '📅 Weekly Task Overview',
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
    
    logger?.info('✅ [Weekly Monitor - Step 2] Weekly overview posted to Slack', { 
      taskCount: formatted.taskCount 
    });
    
    return { posted: true, taskCount: formatted.taskCount };
  },
});

export const weeklyTaskMonitoringWorkflow = createWorkflow({
  id: "weekly-task-monitoring",
  description: "Weekly automated monitoring of Monday.com tasks due in the upcoming week",
  inputSchema: z.object({}),
})
  .then(fetchUpcomingWeekTasksStep)
  .then(formatAndPostWeeklyTasksStep)
  .commit();
