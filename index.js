const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==============================
// PostgreSQL Connection
// ==============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});



// ✅ إنشاء جدول منع تكرار مشاهدة الإعلانات (مرة واحدة)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_ad_views (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        ad_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, ad_id)
      )
    `);
    console.log('user_ad_views table ready ✅');
  } catch (err) {
    console.error('Error creating user_ad_views table', err);
  }
})();



// ✅ إنشاء جدول Task History (مرة واحدة)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        task_type VARCHAR(50) NOT NULL,
        points INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'completed',
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('user_tasks table ready ✅');
  } catch (err) {
    console.error('Error creating user_tasks table', err);
  }
})();


// ==============================
// Helpers
// ==============================
function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ==============================
// Auth Middleware
// ==============================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ status: 'error', message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
}



function adminMiddleware(req, res, next) {
  const ADMIN_EMAIL = 'ad45821765@gmail.com'; // غيّرها بإيميلك

  pool.query(
    'SELECT email FROM users WHERE id=$1',
    [req.userId]
  ).then(result => {
    if (result.rows[0].email !== ADMIN_EMAIL) {
      return res.status(403).json({ status: 'error', message: 'Admin only' });
    }
    next();
  }).catch(() => {
    res.status(500).json({ status: 'error', message: 'Admin check failed' });
  });
}


// ==============================
// Create Tables
// ==============================
async function createUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      points INT DEFAULT 0,
      balance DECIMAL(10,2) DEFAULT 0,
      referral_code VARCHAR(20) UNIQUE,
      referred_by INT,
      is_banned BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('Users table ready ✅');
}

async function createTasksTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(100) NOT NULL,
      description TEXT,
      task_type VARCHAR(30) NOT NULL,
      reward_points INT NOT NULL,
      duration_seconds INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('Tasks table ready ✅');
}

async function createUserTasksTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_tasks (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      task_id INT NOT NULL,
      status VARCHAR(20) DEFAULT 'started',
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      UNIQUE (user_id, task_id)
    );
  `);
  console.log('User tasks table ready ✅');
}


async function createPointsHistoryTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS points_history (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      action VARCHAR(50) NOT NULL,
      points INT NOT NULL,
      related_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(query);
    console.log('Points history table ready ✅');
  } catch (err) {
    console.error('Error creating points_history ❌', err);
  }
}


async function createWithdrawalsTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      amount_points INT NOT NULL,
      method VARCHAR(30) NOT NULL,
      wallet_or_number VARCHAR(100) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(query);
    console.log('Withdrawals table ready ✅');
  } catch (err) {
    console.error('Error creating withdrawals ❌', err);
  }
}



// ==============================
// Routes
// ==============================
app.get('/', (req, res) => {
  res.json({ status: 'success', message: 'Task to Earn API is running 🚀' });
});

// ---------- Auth ----------
app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ status: 'error', message: 'All fields required' });

  const exists = await pool.query(
    'SELECT id FROM users WHERE email=$1 OR username=$2',
    [email, username]
  );
  if (exists.rows.length)
    return res.status(400).json({ status: 'error', message: 'User exists' });

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (username,email,password_hash,referral_code)
     VALUES ($1,$2,$3,$4)`,
    [username, email, hash, generateReferralCode()]
  );

  res.json({ status: 'success', message: 'User registered successfully' });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!result.rows.length)
    return res.status(401).json({ status: 'error', message: 'Invalid login' });

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok)
    return res.status(401).json({ status: 'error', message: 'Invalid login' });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ status: 'success', token });
});

app.get('/me', authMiddleware, async (req, res) => {
  const user = await pool.query(
    `SELECT id,username,email,points,balance,referral_code,created_at
     FROM users WHERE id=$1`,
    [req.userId]
  );
  res.json({ status: 'success', user: user.rows[0] });
});

// ---------- Ads Tasks ----------
app.post('/admin/add-ad', async (req, res) => {
  const { title, description, reward_points, duration_seconds } = req.body;
  await pool.query(
    `INSERT INTO tasks (title,description,task_type,reward_points,duration_seconds)
     VALUES ($1,$2,'watch_ad',$3,$4)`,
    [title, description, reward_points, duration_seconds]
  );
  res.json({ status: 'success', message: 'Ad added' });
});

app.get('/tasks/ads', authMiddleware, async (req, res) => {
  const tasks = await pool.query(
    `SELECT * FROM tasks WHERE task_type='watch_ad' AND is_active=true`
  );
  res.json({ status: 'success', tasks: tasks.rows });
});

app.post('/tasks/ads/start/:taskId', authMiddleware, async (req, res) => {
  await pool.query(
    `INSERT INTO user_tasks (user_id,task_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.userId, req.params.taskId]
  );
  res.json({ status: 'success', message: 'Ad started' });
});

app.post('/tasks/ads/complete/:taskId', authMiddleware, async (req, res) => {
  const { taskId } = req.params;

  try {
    // 1) هات بيانات التاسك
    const taskRes = await pool.query(
      `SELECT reward_points, duration_seconds FROM tasks WHERE id=$1`,
      [taskId]
    );
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Task not found' });
    }

    // 2) هات وقت البداية
    const userTaskRes = await pool.query(
      `SELECT started_at, status FROM user_tasks WHERE user_id=$1 AND task_id=$2`,
      [req.userId, taskId]
    );
    if (userTaskRes.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Task not started' });
    }
    if (userTaskRes.rows[0].status === 'completed') {
      return res.status(400).json({ status: 'error', message: 'Task already completed' });
    }

    // 3) احسب الوقت
    const startedAt = new Date(userTaskRes.rows[0].started_at);
    const now = new Date();
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);

    if (elapsedSeconds < taskRes.rows[0].duration_seconds) {
      return res.status(400).json({
        status: 'error',
        message: `You must watch at least ${taskRes.rows[0].duration_seconds} seconds`
      });
    }

    // 4) كمّل + زوّد نقاط
    await pool.query(
      `UPDATE user_tasks
       SET status='completed', completed_at=NOW()
       WHERE user_id=$1 AND task_id=$2`,
      [req.userId, taskId]
    );

    await pool.query(
      `UPDATE users SET points = points + $1 WHERE id=$2`,
      [taskRes.rows[0].reward_points, req.userId]
    );



    // ✅ تسجيل إن المستخدم شاف الإعلان
await pool.query(
  'INSERT INTO user_ad_views (user_id, ad_id) VALUES ($1, $2)',
  [req.userId, taskId]
);

    await pool.query(
  `INSERT INTO points_history (user_id, action, points, related_id)
   VALUES ($1, 'watch_ad', $2, $3)`,
  [req.userId, taskRes.rows[0].reward_points, taskId]
);

    res.json({ status: 'success', message: 'Ad completed, points added' });

  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }


// 🚫 منع تكرار نفس الإعلان
const alreadyCompleted = await pool.query(
  'SELECT id FROM user_ad_views WHERE user_id=$1 AND ad_id=$2',
  [req.userId, taskId]
);

if (alreadyCompleted.rows.length > 0) {
  return res.status(400).json({
    status: 'error',
    message: 'Ad already completed'
  });
}

  
});




app.post('/withdraw/request', authMiddleware, async (req, res) => {
  const { amount_points, method, wallet_or_number } = req.body;
  const MIN_WITHDRAW_POINTS = 10;

  if (!amount_points || !method || !wallet_or_number) {
    return res.status(400).json({ status: 'error', message: 'All fields are required' });
  }
  if (amount_points < MIN_WITHDRAW_POINTS) {
    return res.status(400).json({
      status: 'error',
      message: `Minimum withdrawal is ${MIN_WITHDRAW_POINTS} points`
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query(
      'SELECT points FROM users WHERE id=$1 FOR UPDATE',
      [req.userId]
    );

    if (userRes.rows[0].points < amount_points) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', message: 'Insufficient points' });
    }

    await client.query(
      'UPDATE users SET points = points - $1 WHERE id=$2',
      [amount_points, req.userId]
    );

    await client.query(
      `INSERT INTO withdrawals (user_id, amount_points, method, wallet_or_number)
       VALUES ($1,$2,$3,$4)`,
      [req.userId, amount_points, method, wallet_or_number]
    );

    await client.query(
      `INSERT INTO points_history (user_id, action, points)
       VALUES ($1,'withdraw_request',$2)`,
      [req.userId, -amount_points]
    );

    await client.query('COMMIT');

    res.json({ status: 'success', message: 'Withdrawal request submitted' });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ status: 'error', message: 'Withdrawal failed' });
  } finally {
    client.release();
  }
});




app.post('/admin/withdrawals/:id/action', authMiddleware, adminMiddleware, async (req, res) => {
  const { action } = req.body; // approve | reject
  const { id } = req.params;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ status: 'error', message: 'Invalid action' });
  }

  const wd = await pool.query(
    'SELECT user_id, amount_points, status FROM withdrawals WHERE id=$1',
    [id]
  );

  if (!wd.rows.length || wd.rows[0].status !== 'pending') {
    return res.status(400).json({ status: 'error', message: 'Invalid withdrawal' });
  }

  if (action === 'reject') {
    // رجّع النقاط
    await pool.query(
      'UPDATE users SET points = points + $1 WHERE id=$2',
      [wd.rows[0].amount_points, wd.rows[0].user_id]
    );

    await pool.query(
      `INSERT INTO points_history (user_id, action, points)
       VALUES ($1, 'withdraw_rejected', $2)`,
      [wd.rows[0].user_id, wd.rows[0].amount_points]
    );
  }

  await pool.query(
    'UPDATE withdrawals SET status=$1 WHERE id=$2',
    [action === 'approve' ? 'approved' : 'rejected', id]
  );

  res.json({ status: 'success', message: `Withdrawal ${action}d` });
});


app.get('/withdraw/my', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, amount_points, method, wallet_or_number, status, created_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.userId]
    );

    res.json({
      status: 'success',
      withdrawals: result.rows
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch withdrawals'
    });
  }
});




app.get('/admin/withdrawals', authMiddleware, adminMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT w.id, u.username, w.amount_points, w.method, w.wallet_or_number,
            w.status, w.created_at
     FROM withdrawals w
     JOIN users u ON u.id = w.user_id
     ORDER BY w.created_at DESC`
  );

  res.json({ status: 'success', withdrawals: result.rows });
});




// ==============================
// Start Server
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  createUsersTable();
  createTasksTable();
  createUserTasksTable();
  createPointsHistoryTable();
  createWithdrawalsTable();
});
