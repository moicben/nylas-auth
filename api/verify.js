module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { displayedCode, enteredCode } = req.body || {};

  console.log('[VERIFY-2FA]', JSON.stringify({ displayedCode, enteredCode, timestamp: new Date().toISOString() }));

  res.status(200).json({ success: true });
};
