import { mondaySearchWithDocsTool } from './src/mastra/tools/mondayTool';

async function test() {
  console.log('🔍 Testing with validation fixes...\n');
  
  const testQueries = ['SM Education', 'playbook', 'DX Playbook'];
  
  for (const query of testQueries) {
    console.log(`\n=== Testing: "${query}" ===`);
    const result = await mondaySearchWithDocsTool.execute({
      context: {
        searchQuery: query,
        includeFiles: true,
        includeUpdates: false,
      },
      mastra: { getLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }) },
    });
    
    const docCount = result.items.filter((i: any) => i.type === 'document').length;
    const folderCount = result.items.filter((i: any) => i.type === 'folder').length;
    
    console.log(`Total: ${result.totalItems} (${docCount} docs, ${folderCount} folders)`);
    console.log(`Top result: ${result.items[0]?.type === 'document' ? '📄' : '📁'} ${result.items[0]?.documentName || result.items[0]?.folderName || result.items[0]?.itemName}`);
    if (result.items[0]?.type === 'document') {
      console.log(`  URL: ${result.items[0]?.documentUrl}`);
    }
  }
  
  console.log('\n✅ All tests completed');
}

test().catch(console.error);
