// Simple Express backend with lowdb JSON storage
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Low, JSONFile } = require('lowdb');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme_admin_key';

async function initDB() {
  await db.read();
  db.data = db.data || { users: [], tasks: [], completions: [] };
  await db.write();
}

initDB();

// Public: get tasks (only active and sorted by priority)
app.get('/api/tasks', async (req, res) => {
  await db.read();
  const tasks = (db.data.tasks || []).filter(t => t.active).sort((a,b)=> (b.priority||0)-(a.priority||0));
  res.json(tasks);
});

// Public: get leaderboard (top users by balance)
app.get('/api/leaderboard', async (req, res) => {
  await db.read();
  const users = (db.data.users || []).slice().sort((a,b)=> (b.balance||0)-(a.balance||0)).slice(0,10);
  res.json(users);
});

// Public: create/ensure guest user (simple, no password)
app.post('/api/guest', async (req, res) => {
  await db.read();
  const { name } = req.body;
  const id = nanoid(8);
  const user = { id, name: name || 'Guest', balance: 0, referredBy: null, streak: 0 };
  db.data.users.push(user);
  await db.write();
  res.json(user);
});

// Public: complete task (simulate multi-page behavior client-side)
app.post('/api/complete', async (req, res) => {
  await db.read();
  const { userId, taskId } = req.body;
  const user = db.data.users.find(u => u.id === userId);
  const task = db.data.tasks.find(t => t.id === taskId && t.active);
  if (!user || !task) return res.status(400).json({ error: 'Invalid user or task' });

  // Basic anti-abuse check: same user can't complete same task more than once per 60 seconds
  const now = Date.now();
  const recent = db.data.completions.find(c => c.userId === userId && c.taskId === taskId && (now - c.ts) < 60*1000);
  if (recent) return res.status(429).json({ error: 'Too fast. Try again in a moment.' });

  // Credit user
  user.balance = Number((user.balance + task.reward).toFixed(2));
  user.streak = (user.streak || 0) + 1;
  db.data.completions.push({ id: nanoid(10), userId, taskId, ts: now, reward: task.reward });
  await db.write();
  res.json({ success: true, balance: user.balance });
});

// Admin: add task
app.post('/api/admin/task', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  await db.read();
  const { title, description, category, reward, priority } = req.body;
  const task = {
    id: nanoid(10),
    title,
    description,
    category: category || 'General',
    reward: Number(reward) || 0,
    priority: Number(priority) || 0,
    active: true,
    createdAt: Date.now()
  };
  db.data.tasks.push(task);
  await db.write();
  res.json({ success: true, task });
});

// Admin: list tasks
app.get('/api/admin/tasks', async (req,res) => {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  await db.read();
  res.json(db.data.tasks || []);
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> {
  console.log('Backend running on', PORT);
});