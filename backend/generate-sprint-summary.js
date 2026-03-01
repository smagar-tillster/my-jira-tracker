import { generateSprintSummary, formatSummaryAsMarkdown } from './src/services/sprintSummaryService.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SPRINT_FILTER_ID = process.env.JIRA_FILTER_ID_SPRINT || process.env.JIRA_FILTER_ID || '60259';

async function main() {
  try {
    console.log(`🔄 Generating sprint summary from filter ${SPRINT_FILTER_ID}...`);
    
    // Generate summary
    const summary = await generateSprintSummary(SPRINT_FILTER_ID);
    
    if (summary.error) {
      console.error('❌ Error:', summary.error);
      process.exit(1);
    }

    // Format as markdown
    const markdown = formatSummaryAsMarkdown(summary, 'Current Sprint');
    
    // Save to file
    const outputPath = path.join(process.cwd(), 'SPRINT_SUMMARY.md');
    fs.writeFileSync(outputPath, markdown, 'utf8');
    
    console.log('✅ Sprint summary generated successfully!');
    console.log(`📄 File saved to: ${outputPath}`);
    console.log(`\n📊 Summary Stats:`);
    console.log(`   - Total Tickets: ${summary.totalTickets}`);
    console.log(`   - Completion Rate: ${summary.metrics.completionRate}%`);
    console.log(`   - Tickets at Risk: ${summary.ticketsAtRisk.length}`);
    console.log(`   - Team Members: ${summary.workloadDistribution.length}`);
    
  } catch (error) {
    console.error('❌ Failed to generate sprint summary:', error.message);
    process.exit(1);
  }
}

main();
