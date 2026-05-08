const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const queryAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const queryOne = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const runSql = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve({ id: this.lastID, changes: this.changes });
  });
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

const requireRole = (roles) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    next();
  };
};

app.use('/api', (req, res, next) => {
  const publicPaths = ['/login'];
  if (publicPaths.includes(req.path) || req.method === 'OPTIONS') {
    return next();
  }
  return authMiddleware(req, res, next);
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  try {
    const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/profile', async (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, id: req.user.id });
});

app.get('/api/users', requireRole('admin'), async (req, res) => {
  try {
    const users = await queryAll('SELECT id, username, role FROM users ORDER BY id DESC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireRole('admin'), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Usuário, senha e função são obrigatórios' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = await runSql('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hash, role]);
    res.json({ id: result.id, username, role });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Nome de usuário já existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { username, password, role } = req.body;
  if (!username || !role) {
    return res.status(400).json({ error: 'Usuário e função são obrigatórios' });
  }

  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const hashedPassword = password ? bcrypt.hashSync(password, 10) : user.password;
    await runSql('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?', [username, hashedPassword, role, id]);
    res.json({ id: Number(id), username, role });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Nome de usuário já existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'Não é possível excluir seu próprio usuário' });
  }

  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    await runSql('DELETE FROM users WHERE id = ?', [id]);
    res.json({ id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients', async (req, res) => {
  try {
    const clients = await queryAll('SELECT * FROM clients ORDER BY id DESC');
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  const { name, phone, email, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const result = await runSql(
      'INSERT INTO clients (name, phone, email, notes) VALUES (?, ?, ?, ?)',
      [name, phone || '', email || '', notes || '']
    );
    res.json({ id: result.id, name, phone, email, notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    await runSql('UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?', [name, phone || '', email || '', notes || '', id]);
    res.json({ id, name, phone, email, notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const dependency = await queryOne('SELECT COUNT(*) AS count FROM appointments WHERE clientId = ?', [id]);
    if (dependency.count > 0) {
      return res.status(400).json({ error: 'Não é possível excluir cliente com agendamentos' });
    }
    await runSql('DELETE FROM clients WHERE id = ?', [id]);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/barbers', async (req, res) => {
  try {
    const barbers = await queryAll('SELECT * FROM barbers ORDER BY id DESC');
    res.json(barbers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/barbers', async (req, res) => {
  const { name, specialty, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome do barbeiro é obrigatório' });
  try {
    const result = await runSql(
      'INSERT INTO barbers (name, specialty, phone) VALUES (?, ?, ?)',
      [name, specialty || '', phone || '']
    );
    res.json({ id: result.id, name, specialty, phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/barbers/:id', async (req, res) => {
  const { id } = req.params;
  const { name, specialty, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome do barbeiro é obrigatório' });
  try {
    await runSql('UPDATE barbers SET name = ?, specialty = ?, phone = ? WHERE id = ?', [name, specialty || '', phone || '', id]);
    res.json({ id, name, specialty, phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/barbers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const dependency = await queryOne('SELECT COUNT(*) AS count FROM appointments WHERE barberId = ?', [id]);
    if (dependency.count > 0) {
      return res.status(400).json({ error: 'Não é possível excluir barbeiro com agendamentos' });
    }
    await runSql('DELETE FROM barbers WHERE id = ?', [id]);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/services', async (req, res) => {
  try {
    const services = await queryAll('SELECT * FROM services ORDER BY id DESC');
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/services', async (req, res) => {
  const { name, duration, price } = req.body;
  if (!name || !duration || !price) return res.status(400).json({ error: 'Nome, duração e preço são obrigatórios' });
  try {
    const result = await runSql(
      'INSERT INTO services (name, duration, price) VALUES (?, ?, ?)',
      [name, duration, price]
    );
    res.json({ id: result.id, name, duration, price });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/services/:id', async (req, res) => {
  const { id } = req.params;
  const { name, duration, price } = req.body;
  if (!name || !duration || !price) return res.status(400).json({ error: 'Nome, duração e preço são obrigatórios' });
  try {
    await runSql('UPDATE services SET name = ?, duration = ?, price = ? WHERE id = ?', [name, duration, price, id]);
    res.json({ id, name, duration, price });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const dependency = await queryOne('SELECT COUNT(*) AS count FROM appointments WHERE serviceId = ?', [id]);
    if (dependency.count > 0) {
      return res.status(400).json({ error: 'Não é possível excluir serviço com agendamentos' });
    }
    await runSql('DELETE FROM services WHERE id = ?', [id]);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/appointments', async (req, res) => {
  try {
    const appointments = await queryAll(`
      SELECT a.id, a.date, a.time, a.status, a.notes,
        a.clientId, a.barberId, a.serviceId,
        c.name AS clientName, b.name AS barberName, s.name AS serviceName,
        s.price AS servicePrice
      FROM appointments a
      JOIN clients c ON c.id = a.clientId
      JOIN barbers b ON b.id = a.barberId
      JOIN services s ON s.id = a.serviceId
      ORDER BY a.date, a.time
    `);
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/appointments', async (req, res) => {
  const { clientId, barberId, serviceId, date, time, notes, status } = req.body;
  if (!clientId || !barberId || !serviceId || !date || !time) {
    return res.status(400).json({ error: 'Todos os campos principais são obrigatórios' });
  }
  try {
    const result = await runSql(
      'INSERT INTO appointments (clientId, barberId, serviceId, date, time, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [clientId, barberId, serviceId, date, time, status || 'Agendado', notes || '']
    );
    res.json({ id: result.id, clientId, barberId, serviceId, date, time, status: status || 'Agendado', notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/appointments/:id', async (req, res) => {
  const { id } = req.params;
  const { clientId, barberId, serviceId, date, time, status, notes } = req.body;
  if (!clientId || !barberId || !serviceId || !date || !time) {
    return res.status(400).json({ error: 'Todos os campos principais são obrigatórios' });
  }
  try {
    await runSql(
      'UPDATE appointments SET clientId = ?, barberId = ?, serviceId = ?, date = ?, time = ?, status = ?, notes = ? WHERE id = ?',
      [clientId, barberId, serviceId, date, time, status || 'Agendado', notes || '', id]
    );
    res.json({ id, clientId, barberId, serviceId, date, time, status: status || 'Agendado', notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/appointments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await runSql('DELETE FROM appointments WHERE id = ?', [id]);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/summary', async (req, res) => {
  const { start, end } = req.query;
  const filters = [];
  const params = [];

  if (start) {
    filters.push('a.date >= ?');
    params.push(start);
  }

  if (end) {
    filters.push('a.date <= ?');
    params.push(end);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const summary = await queryOne(`
      SELECT
        COUNT(*) AS appointments,
        SUM(CASE WHEN a.status = 'Concluido' THEN s.price ELSE 0 END) AS totalRevenue,
        SUM(CASE WHEN a.status = 'Agendado' THEN 1 ELSE 0 END) AS scheduledCount,
        SUM(CASE WHEN a.status = 'Concluido' THEN 1 ELSE 0 END) AS completedCount,
        SUM(CASE WHEN a.status = 'Cancelado' THEN 1 ELSE 0 END) AS canceledCount
      FROM appointments a
      JOIN services s ON s.id = a.serviceId
      ${where}
    `, params);

    summary.totalRevenue = summary.totalRevenue || 0;

    const byBarber = await queryAll(`
      SELECT b.name AS barberName,
        COUNT(*) AS totalAppointments,
        SUM(CASE WHEN a.status = 'Concluido' THEN s.price ELSE 0 END) AS revenue
      FROM appointments a
      JOIN barbers b ON b.id = a.barberId
      JOIN services s ON s.id = a.serviceId
      ${where}
      GROUP BY b.name
      ORDER BY revenue DESC
    `, params);

    res.json({ summary, byBarber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

init().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Falha ao iniciar o banco de dados:', err);
});
