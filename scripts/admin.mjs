import { openStore, hashPassword, transaction } from '../src/store.mjs';

const username = process.argv[2]?.toLowerCase();
const secret = (await new Promise((resolve, reject) => {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => resolve(input));
  process.stdin.on('error', reject);
})).replace(/\r?\n$/, '');
if (!/^[a-z0-9][a-z0-9_.-]{2,47}$/.test(username || '') || username === 'training-demo' ||
    secret.length < 12 || secret.length > 256 || secret !== secret.trim()) {
  console.error('Usage: pipe a 12–256 character password without surrounding whitespace into npm run admin -- <username>.');
  process.exit(1);
}
const hash = await hashPassword(secret);
const db = openStore();
try {
  transaction(db, () => {
    const user = db.prepare('SELECT id,role FROM users WHERE username=?').get(username);
    if (!user) db.prepare("INSERT INTO users(username,password_hash,role) VALUES (?,?,'admin')").run(username, hash);
    else {
      if (user.role !== 'admin') throw new Error('Choose a new admin username or reset an existing admin.');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    }
  });
  console.log('Administrator is ready.');
} finally { db.close(); }
