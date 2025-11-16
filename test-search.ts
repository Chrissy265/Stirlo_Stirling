import { mondaySearchWithDocsTool } from './src/mastra/tools/mondayTool';
import { mastra } from './src/mastra';

async function testSearch() {
  console.log('\n🔍 Testing search precision with "roundtable playbook"...\n');
  
  try {
    const result = await mondaySearchWithDocsTool.execute({
      context: {
        searchQuery: 'roundtable playbook',
        includeFiles: true,
        includeUpdates: true, // MUST be true to get files from update assets
      },
      mastra,
    });
    
    console.log('✅ Search Results:');
    console.log(`   Total Items Found: ${result.totalItems}`);
    console.log(`   Total Files Found: ${result.totalFiles}`);
    console.log(`   Workspaces Searched: ${result.workspacesSearched.join(', ')}`);
    console.log('\n📋 Items and their relevance scores:');
    
    result.items.slice(0, 10).forEach((item: any, index: number) => {
      console.log(`   ${index + 1}. ${item.itemName} (Score: ${item.relevanceScore}, Files: ${item.documentation.files.length})`);
    });
    
    console.log(`\n   ... and ${Math.max(0, result.items.length - 10)} more items\n`);
    
  } catch (error) {
    console.error('❌ Search failed:', error);
  }
}

testSearch();
