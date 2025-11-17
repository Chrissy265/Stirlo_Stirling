import { mondayGetTasksByDateRangeTool } from './src/mastra/tools/mondayTool';
import { slackPostMessageTool, slackFormatTaskListTool } from './src/mastra/tools/slackTool';

async function test() {
  console.log('🧪 Testing Task Monitoring System\n');
  console.log('='.repeat(50));
  
  const mockMastra = {
    getLogger: () => ({
      info: (...args: any[]) => console.log('[INFO]', ...args),
      debug: (...args: any[]) => console.log('[DEBUG]', ...args),
      warn: (...args: any[]) => console.warn('[WARN]', ...args),
      error: (...args: any[]) => console.error('[ERROR]', ...args),
    }),
  };
  
  try {
    console.log('\n\n📅 Step 1: Fetching tasks due today...\n');
    const todayTasks = await mondayGetTasksByDateRangeTool.execute({
      context: { dateRange: 'today' },
      mastra: mockMastra as any,
      runtimeContext: {} as any,
    });
    
    console.log(`✅ Found ${todayTasks.totalTasks} tasks due today`);
    console.log(`   Date range: ${todayTasks.dateRange}`);
    
    if (todayTasks.totalTasks > 0) {
      console.log('\n   Sample tasks:');
      todayTasks.tasks.slice(0, 3).forEach((task: any, idx: number) => {
        console.log(`   ${idx + 1}. ${task.itemName} (${task.deadlineFormatted})`);
        console.log(`      Board: ${task.boardName}`);
        console.log(`      Assignees: ${task.assignees.join(', ') || 'Unassigned'}`);
      });
    }
    
    console.log('\n\n📌 Step 2: Fetching end-of-week tasks...\n');
    const endOfWeekTasks = await mondayGetTasksByDateRangeTool.execute({
      context: { dateRange: 'end-of-week' },
      mastra: mockMastra as any,
      runtimeContext: {} as any,
    });
    
    console.log(`✅ Found ${endOfWeekTasks.totalTasks} tasks due end of week`);
    console.log(`   Date range: ${endOfWeekTasks.dateRange}`);
    
    console.log('\n\n📅 Step 3: Fetching upcoming week tasks...\n');
    const weeklyTasks = await mondayGetTasksByDateRangeTool.execute({
      context: { dateRange: 'upcoming-week' },
      mastra: mockMastra as any,
      runtimeContext: {} as any,
    });
    
    console.log(`✅ Found ${weeklyTasks.totalTasks} tasks in upcoming week`);
    console.log(`   Date range: ${weeklyTasks.dateRange}`);
    
    if (weeklyTasks.totalTasks > 0) {
      console.log('\n\n💬 Step 4: Formatting Slack message...\n');
      const formatted = await slackFormatTaskListTool.execute({
        context: {
          tasks: weeklyTasks.tasks.slice(0, 5), // Test with first 5 tasks
          title: '📅 Weekly Task Overview (TEST)',
          dateRange: weeklyTasks.dateRange,
        },
        mastra: mockMastra as any,
        runtimeContext: {} as any,
      });
      
      console.log('✅ Message formatted successfully');
      console.log(`   Task count: ${formatted.taskCount}`);
      console.log('\n   Preview of Slack message:\n');
      console.log(formatted.formattedText.substring(0, 500) + '...');
      
      console.log('\n\n📤 Step 5: Posting test message to Slack...\n');
      const posted = await slackPostMessageTool.execute({
        context: {
          channel: 'stirlo-assistant',
          text: `🧪 *Test Message*\n\nThis is a test of the automated task monitoring system. Found ${weeklyTasks.totalTasks} tasks in the upcoming week.\n\nThe actual daily and weekly reports will be posted automatically at 8 AM Australian time.`,
        },
        mastra: mockMastra as any,
        runtimeContext: {} as any,
      });
      
      console.log(`✅ Message posted to #${posted.channel}`);
      console.log(`   Timestamp: ${posted.timestamp}`);
    }
    
    console.log('\n\n✅ All tests passed!');
    console.log('\n📋 Summary:');
    console.log(`   - Tasks due today: ${todayTasks.totalTasks}`);
    console.log(`   - Tasks due end of week: ${endOfWeekTasks.totalTasks}`);
    console.log(`   - Tasks in upcoming week: ${weeklyTasks.totalTasks}`);
    console.log('\n🔔 Check #stirlo-assistant in Slack for the test message');
    
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

test();
