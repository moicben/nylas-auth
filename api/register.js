module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { email, phone, fullName } = req.body || {};

  console.log('[REGISTER]', JSON.stringify({ email, phone, fullName, timestamp: new Date().toISOString() }));

  res.status(200).json({ success: true });
};
