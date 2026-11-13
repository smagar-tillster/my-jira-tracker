import express from 'express';
import axios from 'axios';

// Jira's issue type icons. Jira serves them only to a logged-in user, so the page asks this route and the backend fetches the image with its
// own Jira login. Only the icon paths of the configured Jira host are served (never an arbitrary address), and the answer must be an image.
const ICON_PATH = /^\/(rest\/api\/\d\/universal_avatar\/view\/type\/issuetype\/avatar\/\d+|images\/icons\/issuetypes\/[\w.-]+)$/;

/** The icon URL if it is an issue type icon of `host`, else null. */
export const iconUrlFor = (raw, host) => {
  try {
    const u = new URL(String(raw));
    const h = new URL(host);
    if (u.origin !== h.origin || !ICON_PATH.test(u.pathname)) return null;
    return `${u.origin}${u.pathname}${u.searchParams.has('size') ? `?size=${encodeURIComponent(u.searchParams.get('size'))}` : ''}`;
  } catch { return null; }
};

const realFetch = async (url) => {
  const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`;
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000, headers: { Authorization: auth, Accept: 'image/*' }, validateStatus: () => true });
  return { status: r.status, type: String(r.headers['content-type'] || ''), body: Buffer.from(r.data) };
};

export const createJiraIconRouter = ({ host = process.env.JIRA_HOST, fetchIcon = realFetch } = {}) => {
  const router = express.Router();
  // GET /api/jira-icon?u=<the icon URL Jira gave for the issue type>
  router.get('/jira-icon', async (req, res) => {
    const url = host ? iconUrlFor(req.query.u, host) : null;
    if (!url) return res.status(400).json({ success: false, error: 'Not a Jira issue type icon' });
    try {
      const r = await fetchIcon(url);
      if (r.status !== 200 || !/^image\//i.test(r.type)) return res.status(502).json({ success: false, error: 'Jira did not return an image' });
      res.set({ 'Content-Type': r.type.split(';')[0], 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(r.body);
    } catch { res.status(502).json({ success: false, error: 'Could not reach Jira' }); }
  });
  return router;
};

export default createJiraIconRouter();
