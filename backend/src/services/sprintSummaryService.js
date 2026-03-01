import { getIssuesFromFilter } from './jiraService.js';

/**
 * Generate a comprehensive sprint summary from issues
 * @param {string} filterId - Jira filter ID for the sprint
 * @returns {Promise<Object>} Sprint summary data
 */
export const generateSprintSummary = async (filterId) => {
  try {
    const issues = await getIssuesFromFilter(filterId);
    
    if (!issues || issues.length === 0) {
      return {
        error: 'No issues found in sprint',
        totalTickets: 0,
      };
    }

    // Calculate metrics
    const totalTickets = issues.length;
    
    // Status breakdown
    const statusBreakdown = issues.reduce((acc, issue) => {
      const status = issue.status || 'Unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    // Story points (using time estimates as proxy if story points not available)
    const ticketsWithEstimates = issues.filter(i => i.originalEstimate > 0);
    const totalCommitted = ticketsWithEstimates.reduce((sum, i) => sum + (i.originalEstimate || 0), 0);
    const completedTickets = issues.filter(i => i.statusCategory === 'Done');
    const totalCompleted = completedTickets.reduce((sum, i) => sum + (i.originalEstimate || 0), 0);

    // Highest effort tickets (top 5 by original estimate)
    const highestEffortTickets = [...issues]
      .filter(i => i.originalEstimate > 0)
      .sort((a, b) => (b.originalEstimate || 0) - (a.originalEstimate || 0))
      .slice(0, 5)
      .map(i => ({
        key: i.key,
        summary: i.summary,
        estimate: i.originalEstimate,
        estimateHours: Math.round(i.originalEstimate / 3600),
        status: i.status,
        assignee: i.assignee,
      }));

    // Tickets at risk
    const now = new Date();
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000);
    
    const ticketsAtRisk = issues.filter(issue => {
      const isBlocked = issue.status.toLowerCase().includes('blocked') || 
                       issue.status.toLowerCase().includes('impediment');
      
      const isLongInProgress = issue.status === 'In Progress' && 
                               issue.updated && 
                               new Date(issue.updated) < fiveDaysAgo;
      
      return isBlocked || isLongInProgress;
    }).map(i => ({
      key: i.key,
      summary: i.summary,
      status: i.status,
      assignee: i.assignee,
      updated: i.updated,
      daysInProgress: Math.floor((now - new Date(i.updated)) / (1000 * 60 * 60 * 24)),
    }));

    // Workload distribution by assignee
    const workloadByAssignee = issues.reduce((acc, issue) => {
      const assignee = issue.assignee || 'Unassigned';
      if (!acc[assignee]) {
        acc[assignee] = {
          total: 0,
          todo: 0,
          inProgress: 0,
          done: 0,
          blocked: 0,
          estimate: 0,
        };
      }
      acc[assignee].total += 1;
      acc[assignee].estimate += issue.originalEstimate || 0;
      
      if (issue.statusCategory === 'Done') {
        acc[assignee].done += 1;
      } else if (issue.status === 'In Progress') {
        acc[assignee].inProgress += 1;
      } else if (issue.status.toLowerCase().includes('blocked')) {
        acc[assignee].blocked += 1;
      } else {
        acc[assignee].todo += 1;
      }
      
      return acc;
    }, {});

    // Sort workload by total tickets
    const sortedWorkload = Object.entries(workloadByAssignee)
      .map(([assignee, data]) => ({
        assignee,
        ...data,
        estimateHours: Math.round(data.estimate / 3600),
        completionRate: data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Calculate key insights
    const completionRate = totalTickets > 0 ? Math.round((completedTickets.length / totalTickets) * 100) : 0;
    const inProgressCount = issues.filter(i => i.status === 'In Progress').length;
    const todoCount = issues.filter(i => i.status === 'To Do').length;
    const blockedCount = issues.filter(i => i.status.toLowerCase().includes('blocked')).length;

    // Generate insights and risks
    const insights = [];
    const risks = [];

    if (completionRate >= 80) {
      insights.push('Strong sprint progress with ' + completionRate + '% completion rate');
    } else if (completionRate >= 50) {
      insights.push('Moderate progress at ' + completionRate + '% completion - on track for delivery');
    } else {
      risks.push('Low completion rate of ' + completionRate + '% - may need scope adjustment');
    }

    if (blockedCount > 0) {
      risks.push(blockedCount + ' ticket(s) currently blocked - requires immediate attention');
    }

    if (ticketsAtRisk.length > blockedCount) {
      risks.push((ticketsAtRisk.length - blockedCount) + ' ticket(s) in progress for 5+ days - may need support');
    }

    if (inProgressCount > completedTickets.length) {
      insights.push('More tickets in progress than completed - focus on finishing over starting');
    }

    if (sortedWorkload.length > 0) {
      const maxLoad = sortedWorkload[0];
      const minLoad = sortedWorkload[sortedWorkload.length - 1];
      if (maxLoad.total > minLoad.total * 2) {
        risks.push('Uneven workload distribution - ' + maxLoad.assignee + ' has ' + maxLoad.total + ' tickets vs ' + minLoad.total);
      }
    }

    // Executive summary bullets
    const executiveSummary = [
      `Sprint contains ${totalTickets} tickets with ${completionRate}% completion rate (${completedTickets.length} done, ${inProgressCount} in progress, ${todoCount} to do)`,
      totalCommitted > 0 
        ? `Committed ${Math.round(totalCommitted / 3600)}h effort, completed ${Math.round(totalCompleted / 3600)}h (${Math.round((totalCompleted / totalCommitted) * 100)}%)`
        : `${completedTickets.length} of ${totalTickets} tickets completed`,
      ticketsAtRisk.length > 0
        ? `${ticketsAtRisk.length} tickets at risk requiring attention (${blockedCount} blocked, ${ticketsAtRisk.length - blockedCount} stalled)`
        : 'No major blockers - sprint on track for delivery',
    ];

    const summary = {
      generated: new Date().toISOString(),
      totalTickets,
      statusBreakdown,
      storyPoints: {
        committed: totalCommitted,
        committedHours: Math.round(totalCommitted / 3600),
        completed: totalCompleted,
        completedHours: Math.round(totalCompleted / 3600),
        completionRate: totalCommitted > 0 ? Math.round((totalCompleted / totalCommitted) * 100) : 0,
      },
      highestEffortTickets,
      ticketsAtRisk,
      workloadDistribution: sortedWorkload,
      insights,
      risks,
      executiveSummary,
      metrics: {
        completionRate,
        inProgressCount,
        todoCount,
        blockedCount,
        doneCount: completedTickets.length,
      },
    };

    return summary;
  } catch (error) {
    console.error('Error generating sprint summary:', error);
    throw error;
  }
};

/**
 * Format sprint summary as markdown
 * @param {Object} summary - Sprint summary data
 * @param {string} sprintName - Name of the sprint
 * @returns {string} Markdown formatted summary
 */
export const formatSummaryAsMarkdown = (summary, sprintName = 'Current Sprint') => {
  const date = new Date(summary.generated).toLocaleString();
  
  let markdown = `# Sprint Summary: ${sprintName}\n\n`;
  markdown += `**Generated:** ${date}\n\n`;
  markdown += `---\n\n`;

  // Executive Summary
  markdown += `## 📊 Executive Summary\n\n`;
  summary.executiveSummary.forEach((bullet, i) => {
    markdown += `${i + 1}. ${bullet}\n`;
  });
  markdown += `\n`;

  // Total Tickets
  markdown += `## 📈 Total Tickets\n\n`;
  markdown += `**${summary.totalTickets}** tickets in sprint\n\n`;

  // Status Breakdown
  markdown += `## 🎯 Status Breakdown\n\n`;
  markdown += `| Status | Count | Percentage |\n`;
  markdown += `|--------|-------|------------|\n`;
  Object.entries(summary.statusBreakdown)
    .sort(([, a], [, b]) => b - a)
    .forEach(([status, count]) => {
      const percentage = Math.round((count / summary.totalTickets) * 100);
      markdown += `| ${status} | ${count} | ${percentage}% |\n`;
    });
  markdown += `\n`;

  // Story Points
  markdown += `## ⚡ Effort Tracking\n\n`;
  if (summary.storyPoints.committed > 0) {
    markdown += `- **Committed:** ${summary.storyPoints.committedHours}h\n`;
    markdown += `- **Completed:** ${summary.storyPoints.completedHours}h\n`;
    markdown += `- **Completion Rate:** ${summary.storyPoints.completionRate}%\n`;
  } else {
    markdown += `- No time estimates available\n`;
    markdown += `- **Tickets Completed:** ${summary.metrics.doneCount} of ${summary.totalTickets}\n`;
  }
  markdown += `\n`;

  // Highest Effort Tickets
  if (summary.highestEffortTickets.length > 0) {
    markdown += `## 🏋️ Highest Effort Tickets (Top 5)\n\n`;
    markdown += `| Ticket | Summary | Estimate | Status | Assignee |\n`;
    markdown += `|--------|---------|----------|--------|----------|\n`;
    summary.highestEffortTickets.forEach(ticket => {
      markdown += `| ${ticket.key} | ${ticket.summary.substring(0, 50)}... | ${ticket.estimateHours}h | ${ticket.status} | ${ticket.assignee} |\n`;
    });
    markdown += `\n`;
  }

  // Tickets at Risk
  markdown += `## ⚠️ Tickets at Risk\n\n`;
  if (summary.ticketsAtRisk.length > 0) {
    markdown += `**${summary.ticketsAtRisk.length}** tickets requiring attention:\n\n`;
    markdown += `| Ticket | Summary | Status | Assignee | Days in Status |\n`;
    markdown += `|--------|---------|--------|----------|----------------|\n`;
    summary.ticketsAtRisk.forEach(ticket => {
      markdown += `| ${ticket.key} | ${ticket.summary.substring(0, 40)}... | ${ticket.status} | ${ticket.assignee} | ${ticket.daysInProgress} days |\n`;
    });
  } else {
    markdown += `✅ No tickets at risk - all on track!\n`;
  }
  markdown += `\n`;

  // Workload Distribution
  markdown += `## 👥 Workload Distribution by Assignee\n\n`;
  markdown += `| Assignee | Total | To Do | In Progress | Done | Blocked | Est. Hours | Completion % |\n`;
  markdown += `|----------|-------|-------|-------------|------|---------|------------|-------------|\n`;
  summary.workloadDistribution.forEach(work => {
    markdown += `| ${work.assignee} | ${work.total} | ${work.todo} | ${work.inProgress} | ${work.done} | ${work.blocked} | ${work.estimateHours}h | ${work.completionRate}% |\n`;
  });
  markdown += `\n`;

  // Key Insights
  markdown += `## 💡 Key Insights\n\n`;
  if (summary.insights.length > 0) {
    summary.insights.forEach(insight => {
      markdown += `- ✅ ${insight}\n`;
    });
  } else {
    markdown += `- No specific insights at this time\n`;
  }
  markdown += `\n`;

  // Delivery Risks
  markdown += `## 🚨 Delivery Risks\n\n`;
  if (summary.risks.length > 0) {
    summary.risks.forEach(risk => {
      markdown += `- ⚠️ ${risk}\n`;
    });
  } else {
    markdown += `- ✅ No major risks identified - sprint on track\n`;
  }
  markdown += `\n`;

  markdown += `---\n\n`;
  markdown += `*Generated from Jira filter data*\n`;

  return markdown;
};
