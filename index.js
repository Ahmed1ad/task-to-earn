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
  ssl: {
    rejectUnauthorized: false
  }
});

// ==============================
// Helpers
// ==============================
function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ==============================
// Create Users Table
// ==============================
async function createUsersTable() {
  const query = `
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
  `;

  try {
    await pool.query(query);
    console.log('Users table ready ✅');
  } catch (error) {
    console.error('Error creating users table ❌', error);
  }
}

// ==============================
// Routes
// ==============================
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Task to Earn API is running 🚀'
  });
});

app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'success',
      db_time: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// ==============================
// Register
// ==============================
app.post('/auth/register', async (req, res) => {
  const { username, email, password, referral_code } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({
      status: 'error',
      message: 'All fields are required'
    });
  }

  try {
    const exists = await pool.query(
      'SELECT id FROM users WHERE email=$1 OR username=$2',
      [email, username]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Username or email already exists'
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const myReferralCode = generateReferralCode();

    let referredBy = null;
    if (referral_code) {
      const refUser = await pool.query(
        'SELECT id FROM users WHERE referral_code=$1',
        [referral_code]
      );
      if (refUser.rows.length > 0) {
        referredBy = refUser.rows[0].id;
      }
    }

    await pool.query(
      `INSERT INTO users 
       (username, email, password_hash, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [username, email, password_hash, myReferralCode, referredBy]
    );

    res.json({
      status: 'success',
      message: 'User registered successfully'
    });

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Registration failed',
      error: error.message
    });
  }
});

// ==============================
// Start Server
// ==============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  createUsersTable();
});