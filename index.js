const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.set('trust proxy', 1);
app.use(express.json());

const tasksLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 دقيقة
  max: 15, // 15 طلب في الدقيقة
  message: {
    status: 'error',
    message: 'طلبات كثيرة جدًا، حاول بعد دقيقة'
  }
});

// طبّقه على كل مسارات التاسكات
app.use('/tasks', tasksLimiter);

// ==============================
// PostgreSQL Connection
// ==============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS banned_ips (
        id SERIAL PRIMARY KEY,
        ip TEXT UNIQUE,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('banned_ips table ready ✅');
  } catch (err) {
    console.error('Error creating banned_ips ❌', err);
  }
})();

// ===============================
// Run once: add status column to user_tasks
// ===============================
(async () => {
  try {
    await pool.query(`
      ALTER TABLE user_tasks
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'started'
    `);
    console.log('status column ready ✅');
  } catch (err) {
    console.error('Error adding status column ❌', err);
  }
})();

// ===============================
// Run once: add ad_url column
// ===============================
(async () => {
  try {
    await pool.query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS ad_url TEXT
    `);
    console.log("ad_url column ready ✅");
  } catch (err) {
    console.error("Error adding ad_url column ❌", err);
  }
})();



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


// ==============================
// Helpers
// ==============================
function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ==============================
// Auth Middleware
// ==============================
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ status: 'error', message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;

    // 🔒 check if user is banned
    const user = await pool.query(
      'SELECT is_banned FROM users WHERE id = $1',
      [req.userId]
    );

    if (!user.rows.length || user.rows[0].is_banned) {
      return res.status(403).json({
        status: 'error',
        message: 'Your account has been banned'
      });
    }

    next();
  } catch (err) {
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



app.use(async (req, res, next) => {
  try {
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket.remoteAddress;

    const banned = await pool.query(
      'SELECT 1 FROM banned_ips WHERE ip = $1',
      [ip]
    );

    if (banned.rows.length) {
      return res.status(403).json({
        status: 'error',
        message: 'Your IP is banned'
      });
    }

    next();
  } catch (err) {
    next();
  }
});


// ===============================
// Run once: add last_ip to users
// ===============================
(async () => {
  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_ip TEXT
    `);
    console.log('last_ip column ready ✅');
  } catch (err) {
    console.error('Error adding last_ip ❌', err);
  }
})();



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


// 📌 جلب IP المستخدم
const ip =
  req.headers['x-forwarded-for']?.split(',')[0] ||
  req.socket.remoteAddress;

// 💾 تخزين IP في حساب المستخدم
await pool.query(
  'UPDATE users SET last_ip = $1 WHERE id = $2',
  [ip, user.id]
);
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ status: 'success', token });
});


app.get('/auth/check', authMiddleware, async (req, res) => {
  const user = await pool.query(
    'SELECT id, username, points FROM users WHERE id = $1',
    [req.userId]
  );

  res.json({
    status: 'success',
    user: user.rows[0]
  });
});


app.get('/me', authMiddleware, async (req, res) => {
  const user = await pool.query(
    `SELECT id,username,email,points,balance,referral_code,created_at
     FROM users WHERE id=$1`,
    [req.userId]
  );
  res.json({ status: 'success', user: user.rows[0] });
});


app.post('/tasks/ads/complete/:taskId', authMiddleware, async (req, res) => {
  const { taskId } = req.params;
  
  if (isNaN(taskId)) {
    return res.status(400).json({
      status: 'error',
      message: 'رقم المهمة غير صحيح'
    });
  }


  try {
    // 1️⃣ جلب بيانات التاسك
    const taskRes = await pool.query(
      'SELECT reward_points, duration_seconds FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskRes.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Task not found'
      });
    }

    const rewardPoints = taskRes.rows[0].reward_points;
    const durationSeconds = taskRes.rows[0].duration_seconds;

    // 2️⃣ جلب بيانات user_task
    const userTaskRes = await pool.query(
      'SELECT started_at, status FROM user_tasks WHERE user_id = $1 AND task_id = $2',
      [req.userId, taskId]
    );

    if (userTaskRes.rows.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Task not started'
      });
    }

    if (userTaskRes.rows[0].status === 'completed') {
      return res.status(400).json({
        status: 'error',
        message: 'Task already completed'
      });
    }

    // 3️⃣ التحقق من مدة المشاهدة
    const startedAt = new Date(userTaskRes.rows[0].started_at);
    const now = new Date();
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);

    if (elapsedSeconds < durationSeconds) {
      return res.status(400).json({
        status: 'error',
        message: `You must watch at least ${durationSeconds} seconds`
      });
    }

    // 4️⃣ تحديث حالة التاسك
    await pool.query(
      `UPDATE user_tasks
       SET status = 'completed', completed_at = NOW()
       WHERE user_id = $1 AND task_id = $2`,
      [req.userId, taskId]
    );

    // 5️⃣ زيادة نقاط المستخدم
    await pool.query(
      'UPDATE users SET points = points + $1 WHERE id = $2',
      [rewardPoints, req.userId]
    );

    // 6️⃣ تسجيل الهستوري (اختياري لكنه مهم)
    await pool.query(
      `INSERT INTO points_history (user_id, action, points, related_id)
       VALUES ($1, 'watch_ad', $2, $3)`,
      [req.userId, rewardPoints, taskId]
    );

    // 7️⃣ تسجيل مشاهدة الإعلان
    await pool.query(
      'INSERT INTO user_ad_views (user_id, ad_id) VALUES ($1, $2)',
      [req.userId, taskId]
    );

    // 8️⃣ الرد النهائي
    res.json({
      status: 'success',
      message: 'Ad completed successfully',
      reward_points: rewardPoints
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
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



app.get('/tasks/my', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `
    SELECT 
      ut.task_id,
      t.title,
      t.task_type,
      t.reward_points,
      ut.status,
      ut.started_at,
      ut.completed_at
    FROM user_tasks ut
    JOIN tasks t ON t.id = ut.task_id
    WHERE ut.user_id = $1
    ORDER BY ut.started_at DESC
    `,
    [req.userId]
  );

  res.json({
    status: 'success',
    tasks: result.rows
  });
});



// ⚠️ Endpoint إداري مؤقت (احذفه بعد الاستخدام)
app.post('/admin/set-task-duration',
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
  const { taskId, duration } = req.body;

if (isNaN(taskId)) {
    return res.status(400).json({
      status: 'error',
      message: 'رقم المهمة غير صحيح'
    });
  }

  if (!taskId || !duration) {
    return res.status(400).json({
      status: 'error',
      message: 'taskId and duration are required'
    });
  }

  await pool.query(
    'UPDATE tasks SET duration_seconds = $1 WHERE id = $2',
    [duration, taskId]
  );

  res.json({
    status: 'success',
    message: `Task ${taskId} duration updated to ${duration} seconds`
  });
});



// ⚠️ TEMP: Reset task for testing
app.post('/admin/reset-user-task', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, taskId } = req.body;
  
  if (isNaN(taskId)) {
    return res.status(400).json({
      status: 'error',
      message: 'رقم المهمة غير صحيح'
    });
  }

  if (!userId || !taskId) {
    return res.status(400).json({ status: 'error', message: 'userId and taskId required' });
  }

  await pool.query(
    'DELETE FROM user_tasks WHERE user_id = $1 AND task_id = $2',
    [userId, taskId]
  );

  res.json({
    status: 'success',
    message: `Task ${taskId} reset for user ${userId}`
  });
});



// ===============================
// Admin - Add Task (with ad_url)
// ===============================
app.post("/admin/add-task", authMiddleware, adminMiddleware, async (req, res) => {
  const {
    title,
    description,
    reward_points,
    duration_seconds,
    ad_url
  } = req.body;

  if (!title || !reward_points || !duration_seconds || !ad_url) {
    return res.status(400).json({
      status: "error",
      message: "title, reward_points, duration_seconds, ad_url are required"
    });
  }

  try {
    await pool.query(
      `INSERT INTO tasks
       (title, description, task_type, reward_points, duration_seconds, ad_url)
       VALUES ($1, $2, 'watch_ad', $3, $4, $5)`,
      [
        title,
        description || "",
        reward_points,
        duration_seconds,
        ad_url
      ]
    );

    res.json({
      status: "success",
      message: "Task added successfully"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Failed to add task"
    });
  }
});




// ===============================
// Admin - Disable Task
// ===============================
app.delete("/admin/delete-task/:id", authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE tasks
       SET is_active = false
       WHERE id = $1`,
      [id]
    );

    res.json({
      status: "success",
      message: "Task disabled successfully"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Failed to delete task"
    });
  }
});




// ===============================
// Get available ad tasks for user
// ===============================
app.get('/tasks/ads', authMiddleware, async (req, res) => {
  try {
    const tasks = await pool.query(`
  SELECT t.*
  FROM tasks t
  WHERE t.task_type = 'watch_ad'
    AND t.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM user_tasks ut
      WHERE ut.user_id = $1
        AND ut.task_id = t.id
        AND ut.status = 'completed'
    )
`, [req.userId]);

    res.json({
      status: 'success',
      tasks: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load tasks'
    });
  }
});



app.get('/tasks/completed', authMiddleware, async (req, res) => {
  const result = await pool.query(
    `
    SELECT t.title, ut.completed_at, t.reward_points
    FROM user_tasks ut
    JOIN tasks t ON t.id = ut.task_id
    WHERE ut.user_id = $1
      AND ut.status = 'completed'
    ORDER BY ut.completed_at DESC
    `,
    [req.userId]
  );

  res.json({
    status: 'success',
    tasks: result.rows
  });
});



app.post('/admin/tasks/:id/toggle', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;

  await pool.query(
    `UPDATE tasks
     SET is_active = NOT is_active
     WHERE id = $1`,
    [id]
  );

  res.json({
    status: 'success',
    message: 'Task status toggled'
  });
});




app.put('/admin/tasks/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { title, description, reward_points, duration_seconds, ad_url } = req.body;

  await pool.query(
    `
    UPDATE tasks
    SET title=$1,
        description=$2,
        reward_points=$3,
        duration_seconds=$4,
        ad_url=$5
    WHERE id=$6
    `,
    [title, description, reward_points, duration_seconds, ad_url, req.params.id]
  );

  res.json({ status: 'success' });
});


app.post('/tasks/ads/start/:taskId', authMiddleware, async (req, res) => {
  const { taskId } = req.params;

  if (isNaN(taskId)) {
    return res.status(400).json({
      status: 'error',
      message: 'رقم المهمة غير صحيح'
    });
  }

  // ❌ لو كان كملها قبل كده
  const viewed = await pool.query(
    'SELECT 1 FROM user_ad_views WHERE user_id=$1 AND ad_id=$2',
    [req.userId, taskId]
  );

  if (viewed.rows.length) {
    return res.status(400).json({
      status: 'error',
      message: 'تم تنفيذ هذه المهمة من قبل'
    });
  }

  // ✅ سجل بدء المهمة (وأعدها started دايمًا)
  await pool.query(
    `
    INSERT INTO user_tasks (user_id, task_id, status, started_at)
    VALUES ($1, $2, 'started', NOW())
    ON CONFLICT (user_id, task_id)
    DO UPDATE SET
      status = 'started',
      started_at = NOW(),
      completed_at = NULL
    `,
    [req.userId, taskId]
  );

  res.json({
    status: 'success',
    message: 'تم بدء المهمة'
  });
});




  app.get('/tasks/ads/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `
    SELECT id, title, description, reward_points, duration_seconds, ad_url
    FROM tasks
    WHERE id = $1 AND is_active = true
    `,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      status: 'error',
      message: 'Task not found'
    });
  }

  res.json({
    status: 'success',
    task: result.rows[0]
  });
});




app.post('/admin/ban-user', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, ban } = req.body; // ban = true | false

  if (typeof ban !== 'boolean') {
    return res.status(400).json({
      status: 'error',
      message: 'ban must be true or false'
    });
  }

  await pool.query(
    'UPDATE users SET is_banned = $1 WHERE id = $2',
    [ban, userId]
  );

  res.json({
    status: 'success',
    message: ban ? 'User banned' : 'User unbanned'
  });
});



app.get('/admin/banned-users', authMiddleware, adminMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT id, username, email, created_at
     FROM users
     WHERE is_banned = true
     ORDER BY created_at DESC`
  );

  res.json({
    status: 'success',
    users: result.rows
  });
});



app.get('/admin/banned-ips', authMiddleware, adminMiddleware, async (req, res) => {
  const result = await pool.query(
    `SELECT ip, reason, created_at
     FROM banned_ips
     ORDER BY created_at DESC`
  );

  res.json({
    status: 'success',
    ips: result.rows
  });
});




// Admin - Unban User
app.post('/admin/unban-user', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({
      status: 'error',
      message: 'userId is required'
    });
  }

  await pool.query(
    'UPDATE users SET is_banned = false WHERE id = $1',
    [userId]
  );

  res.json({
    status: 'success',
    message: 'User unbanned successfully'
  });
});



app.get('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const result = await pool.query(
    `
    SELECT id, username, email, last_ip, is_banned, created_at
    FROM users
    ORDER BY created_at DESC
    `
  );

  res.json({
    status: 'success',
    users: result.rows
  });
});



// ==============================
// Health Check
// ==============================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date()
  });
});



// ==============================
// Health Check (Database)
// ==============================
app.get('/health/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'ok',
      server: 'running',
      database: 'connected'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      server: 'running',
      database: 'disconnected'
    });
  }
});




// ==============================
// Auth Check (Frontend Helper)
// ==============================
app.get('/auth/check', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, points, is_banned
       FROM users
       WHERE id = $1`,
      [req.userId]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        status: 'error',
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    if (user.is_banned) {
      return res.status(403).json({
        status: 'banned',
        message: 'User is banned'
      });
    }

    res.json({
      status: 'success',
      user
    });

  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Auth check failed'
    });
  }
});


app.post('/tasks/ads/fail/:taskId', authMiddleware, async (req, res) => {
  const { taskId } = req.params;

  await pool.query(`
    UPDATE user_tasks
    SET status = 'failed'
    WHERE user_id = $1
      AND task_id = $2
      AND status = 'started'
  `, [req.userId, taskId]);

  res.json({
    status: 'success',
    message: 'Task failed'
  });
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
