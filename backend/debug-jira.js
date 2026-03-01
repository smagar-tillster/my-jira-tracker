import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const JIRA_HOST = process.env.JIRA_HOST;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

const jiraClient = axios.create({
  baseURL: `${JIRA_HOST}/rest/api/3`,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
    'Content-Type': 'application/json',
  },
});

async function testPagination() {
  try {
    const filterId = process.env.JIRA_FILTER_ID;
    console.log('Testing with filter ID:', filterId);
    
    const response = await jiraClient.get('/search/jql', {
      params: {
        jql: `filter = ${filterId}`,
        maxResults: 50,
        startAt: 0,
        fields: 'key,summary,status',
      },
    });

    console.log('\n=== RESPONSE STRUCTURE ===');
    console.log('Response data keys:', Object.keys(response.data));
    console.log('\nTotal:', response.data.total);
    console.log('StartAt:', response.data.startAt);
    console.log('MaxResults:', response.data.maxResults);
    console.log('Issues count:', response.data.issues.length);
    
    if (response.data.issues.length > 0) {
      console.log('\nFirst issue keys:', Object.keys(response.data.issues[0]));
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

testPagination();
