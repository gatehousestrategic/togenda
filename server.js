const express = require('express');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Serve config.js dynamically so credentials live in Render env vars, not git
app.get('/config.js', (req, res) => {
  const url  = process.env.SUPABASE_URL  || '';
  const anon = process.env.SUPABASE_ANON_KEY || '';
  res.type('application/javascript');
  res.send(
    `const SUPABASE_URL = '${url}';\nconst SUPABASE_ANON_KEY = '${anon}';\n`
  );
});

// Serve all static files (html, css, js, icons, etc.)
app.use(express.static(path.join(__dirname), {
  index: false,          // handled by SPA fallback below
  extensions: ['html'],
}));

// ── POST /api/invite ─────────────────────────────────────────────
// Any signed-in user can invite a new email address.
app.post('/api/invite', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Not signed in' });

  const { email } = req.body || {};
  if (!email || !email.includes('@'))
    return res.status(400).json({ error: 'Valid email required' });

  const url         = process.env.SUPABASE_URL;
  const anon        = process.env.SUPABASE_ANON_KEY;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole)
    return res.status(500).json({ error: 'Server not configured' });

  // Verify the caller has a valid session
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: 'Session invalid' });

  // Use service role to send the invite
  const adminClient = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: process.env.APP_URL || req.headers.origin || undefined,
  });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// SPA fallback — all other routes serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Togenda listening on port ${PORT}`));
