const fs = require('fs');
const path = require('path');

const CODE_FILE = path.join('/tmp', 'verification-code.json');

function readCode() {
  try {
    const data = JSON.parse(fs.readFileSync(CODE_FILE, 'utf8'));
    return data.code || 'XXXXXXXX';
  } catch {
    return 'XXXXXXXX';
  }
}

function writeCode(code) {
  fs.writeFileSync(CODE_FILE, JSON.stringify({ code }), 'utf8');
}

module.exports = function handler(req, res) {
  if (req.method === 'GET') {
    const code = readCode();
    console.log('[VERIFICATION-CODE:GET]', code);
    res.status(200).json({ code });
    return;
  }

  if (req.method === 'POST') {
    const { code } = req.body || {};
    if (typeof code === 'string' && code.length > 0) {
      writeCode(code);
    }
    const saved = readCode();
    console.log('[VERIFICATION-CODE:POST]', saved);
    res.status(200).json({ success: true, code: saved });
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
};
