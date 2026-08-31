// GET /api/session  → { authed: true|false }  (panel sprawdza, czy jesteś zalogowany)
const { isAuthed } = require('./_lib');

module.exports = async function handler(req, res) {
  return res.status(200).json({ authed: isAuthed(req) });
};
