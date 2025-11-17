import { mondaySearchWithDocsTool } from './src/mastra/tools/mondayTool';

async function test() {
  console.log('🔍 Testing: "DX Playbook"...\n');
  
  try {
    const result = await mondaySearchWithDocsTool.execute({
      context: {
        searchQuery: 'DX Playbook',
        includeFiles: true,
        includeUpdates: false,
      },
      mastra: { getLogger: () => ({ 
        info: console.log, 
        debug: console.log, 
        warn: console.warn, 
        error: console.error 
      }) },
    });
    
    console.log('\n✅ Total Items:', result.totalItems);
    console.log('\nTop 3 Results:\n');
    result.items.slice(0, 3).forEach((item: any) => {
      console.log(`${item.type === 'document' ? '📄' : item.type === 'folder' ? '📁' : '📋'} ${item.documentName || item.folderName || item.itemName}`);
      if (item.type === 'document') console.log(`  URL: ${item.documentUrl}`);
      console.log(`  Score: ${item.relevanceScore}\n`);
    });
  } catch (e: any) {
    console.error('\n❌ Error:', e.message);
    console.error('Stack:', e.stack);
  }
}

test().catch(console.error);
