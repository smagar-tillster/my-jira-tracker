import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const jiraClient = axios.create({
  baseURL: `${process.env.JIRA_HOST}/rest/api/3`,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`,
    'Content-Type': 'application/json'
  }
});

jiraClient.get('/issue/NGK-80897')
  .then(res => {
    console.log('All custom fields for NGK-80897:');
    Object.keys(res.data.fields)
      .filter(k => k.startsWith('customfield_'))
      .forEach(k => {
        if (res.data.fields[k]) {
          console.log(`${k}: ${JSON.stringify(res.data.fields[k])}`);
        }
      });
  })
  .catch(err => console.error('Error:', err.message));
