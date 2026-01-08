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
  last_ip TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  task_type VARCHAR(30) NOT NULL,
  reward_points INT NOT NULL,
  duration_seconds INT DEFAULT 0,
  ad_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_tasks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  task_id INT NOT NULL,
  status VARCHAR(20) DEFAULT 'started',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_proofs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  task_id INT NOT NULL,
  image_url TEXT NOT NULL,
  image_public_id TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
