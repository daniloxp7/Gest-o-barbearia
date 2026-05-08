const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const VALID_ROLES = ['admin', 'manager', 'attendant'];
const VALID_STATUSES = ['Agendado', 'Concluido', 'Cancelado'];
const PUBLIC_TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30'
];
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET deve ser definido em producao.');
}

if (!process.env.JWT_SECRET) {
  console.warn('Aviso: usando JWT_SECRET de desenvolvimento. Defina JWT_SECRET antes de publicar.');
}

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : false;

app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
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

const isPositiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const normalizeStatus = (status) => status || 'Agendado';
const validateRole = (role) => VALID_ROLES.includes(role);
const validateStatus = (status) => VALID_STATUSES.includes(normalizeStatus(status));
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const isTime = (value) => /^\d{2}:\d{2}$/.test(value || '');
const todayIso = () => new Date().toISOString().slice(0, 10);
const toMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60) + minutes;
};
const overlaps = (startA, durationA, startB, durationB) => {
  const endA = startA + durationA;
  const endB = startB + durationB;
  return startA < endB && startB < endA;
};

const assertDateTime = ({ date, time, allowPast = true }) => {
  if (!isIsoDate(date) || !isTime(time)) {
    const error = new Error('Data ou horario invalido');
    error.statusCode = 400;
    throw error;
  }

  if (!allowPast && date < todayIso()) {
    const error = new Error('Nao e possivel agendar em data passada');
    error.statusCode = 400;
    throw error;
  }
};

const assertAppointmentReferences = async (clientId, barberId, serviceId) => {
  const [client, barber, service] = await Promise.all([
    queryOne('SELECT id FROM clients WHERE id = ?', [clientId]),
    queryOne('SELECT id FROM barbers WHERE id = ?', [barberId]),
    queryOne('SELECT id FROM services WHERE id = ?', [serviceId])
  ]);

  if (!client || !barber || !service) {
    const error = new Error('Cliente, barbeiro ou servico nao encontrado');
    error.statusCode = 400;
    throw error;
  }
};

const assertAvailableSlot = async ({ barberId, serviceId, date, time, appointmentId = null, status = 'Agendado' }) => {
  if (normalizeStatus(status) === 'Cancelado') return;

  const service = await queryOne('SELECT duration FROM services WHERE id = ?', [serviceId]);
  if (!service) {
    const error = new Error('Servico nao encontrado');
    error.statusCode = 400;
    throw error;
  }

  const params = [barberId, date];
  let sql = `
    SELECT a.id, a.time, s.duration
    FROM appointments a
    JOIN services s ON s.id = a.serviceId
    WHERE a.barberId = ? AND a.date = ? AND a.status <> 'Cancelado'
  `;

  if (appointmentId) {
    sql += ' AND a.id <> ?';
    params.push(appointmentId);
  }

  const appointments = await queryAll(sql, params);
  const requestedStart = toMinutes(time);
  const conflict = appointments.find((appointment) => (
    overlaps(requestedStart, Number(service.duration), toMinutes(appointment.time), Number(appointment.duration))
  ));

  if (conflict) {
    const error = new Error('Ja existe um agendamento para este barbeiro neste horario');
    error.statusCode = 409;
    throw error;
  }
};

const sendError = (res, err) => {
  res.status(err.statusCode || 500).json({ error: err.message });
};

const findOrCreateClient = async ({ name, phone, email }) => {
  const cleanPhone = (phone || '').trim();
  const cleanEmail = (email || '').trim();

  if (cleanPhone) {
    const byPhone = await queryOne('SELECT id FROM clients WHERE phone = ?', [cleanPhone]);
    if (byPhone) return byPhone.id;
  }

  if (cleanEmail) {
    const byEmail = await queryOne('SELECT id FROM clients WHERE email = ?', [cleanEmail]);
    if (byEmail) return byEmail.id;
  }

  const result = await runSql(
    'INSERT INTO clients (name, phone, email, notes) VALUES (?, ?, ?, ?)',
    [name.trim(), cleanPhone, cleanEmail, 'Cliente cadastrado pelo agendamento online']
  );
  return result.id;
};

const loginKey = (req, username) => `${req.ip}:${String(username || '').toLowerCase()}`;

const isLoginBlocked = (key) => {
  const entry = loginAttempts.get(key);
  if (!entry) return false;

  if (Date.now() - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }

  return entry.count >= MAX_LOGIN_ATTEMPTS;
};

const recordFailedLogin = (key) => {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
    return;
  }

  entry.count += 1;
  loginAttempts.set(key, entry);
};

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
  const publicPaths = ['/login', '/public/data', '/public/availability', '/public/appointments'];
  if (publicPaths.includes(req.path) || req.method === 'OPTIONS') {
    return next();
  }
  return authMiddleware(req, res, next);
});

app.get('/api/public/data', async (req, res) => {
  try {
    const [barbers, services] = await Promise.all([
      queryAll('SELECT id, name, specialty FROM barbers ORDER BY name'),
      queryAll(`
        SELECT id, name, duration, price
        FROM services
        ORDER BY
          CASE name
            WHEN 'Cabelo' THEN 1
            WHEN 'Barba' THEN 2
            WHEN 'Cabelo + Barba' THEN 3
            ELSE 4
          END,
          name
      `)
    ]);
    res.json({ barbers, services, timeSlots: PUBLIC_TIME_SLOTS });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/public/availability', async (req, res) => {
  const { barberId, serviceId, date } = req.query;
  if (!barberId || !serviceId || !date) {
    return res.status(400).json({ error: 'Barbeiro, servico e data sao obrigatorios' });
  }

  try {
    assertDateTime({ date, time: '00:00', allowPast: false });
    const barber = await queryOne('SELECT id FROM barbers WHERE id = ?', [barberId]);
    const service = await queryOne('SELECT id, duration FROM services WHERE id = ?', [serviceId]);
    if (!barber) return res.status(404).json({ error: 'Barbeiro nao encontrado' });
    if (!service) return res.status(404).json({ error: 'Servico nao encontrado' });

    const booked = await queryAll(
      `SELECT a.time, s.duration
       FROM appointments a
       JOIN services s ON s.id = a.serviceId
       WHERE a.barberId = ? AND a.date = ? AND a.status <> 'Cancelado'`,
      [barberId, date]
    );
    const availableTimes = PUBLIC_TIME_SLOTS.filter((slot) => {
      const slotStart = toMinutes(slot);
      return !booked.some((item) => overlaps(slotStart, Number(service.duration), toMinutes(item.time), Number(item.duration)));
    });
    const bookedTimes = PUBLIC_TIME_SLOTS.filter((slot) => !availableTimes.includes(slot));

    res.json({ bookedTimes, availableTimes });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/public/appointments', async (req, res) => {
  const { name, phone, email, barberId, serviceId, date, time, notes } = req.body;
  if (!name || !phone || !barberId || !serviceId || !date || !time) {
    return res.status(400).json({ error: 'Nome, telefone, barbeiro, servico, data e horario sao obrigatorios' });
  }

  if (!PUBLIC_TIME_SLOTS.includes(time)) {
    return res.status(400).json({ error: 'Horario indisponivel para agendamento online' });
  }

  try {
    assertDateTime({ date, time, allowPast: false });
    const service = await queryOne('SELECT id FROM services WHERE id = ?', [serviceId]);
    const barber = await queryOne('SELECT id FROM barbers WHERE id = ?', [barberId]);
    if (!service || !barber) {
      return res.status(400).json({ error: 'Barbeiro ou servico nao encontrado' });
    }

    await assertAvailableSlot({ barberId, serviceId, date, time });
    const clientId = await findOrCreateClient({ name, phone, email });
    const result = await runSql(
      'INSERT INTO appointments (clientId, barberId, serviceId, date, time, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [clientId, barberId, serviceId, date, time, 'Agendado', notes || 'Agendamento feito pelo cliente']
    );

    res.json({ id: result.id, date, time, status: 'Agendado' });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  const attemptKey = loginKey(req, username);
  if (isLoginBlocked(attemptKey)) {
    return res.status(429).json({ error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' });
  }

  try {
    const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    loginAttempts.delete(attemptKey);
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

  if (!validateRole(role)) {
    return res.status(400).json({ error: 'Funcao invalida' });
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

  if (!validateRole(role)) {
    return res.status(400).json({ error: 'Funcao invalida' });
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
  if (!isPositiveNumber(duration) || !isPositiveNumber(price)) {
    return res.status(400).json({ error: 'Duracao e preco devem ser maiores que zero' });
  }

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
  if (!isPositiveNumber(duration) || !isPositiveNumber(price)) {
    return res.status(400).json({ error: 'Duracao e preco devem ser maiores que zero' });
  }

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
  if (!validateStatus(status)) {
    return res.status(400).json({ error: 'Status invalido' });
  }

  try {
    assertDateTime({ date, time });
    await assertAppointmentReferences(clientId, barberId, serviceId);
    await assertAvailableSlot({ barberId, serviceId, date, time, status });
    const result = await runSql(
      'INSERT INTO appointments (clientId, barberId, serviceId, date, time, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [clientId, barberId, serviceId, date, time, normalizeStatus(status), notes || '']
    );
    res.json({ id: result.id, clientId, barberId, serviceId, date, time, status: normalizeStatus(status), notes });
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/appointments/:id', async (req, res) => {
  const { id } = req.params;
  const { clientId, barberId, serviceId, date, time, status, notes } = req.body;
  if (!clientId || !barberId || !serviceId || !date || !time) {
    return res.status(400).json({ error: 'Todos os campos principais são obrigatórios' });
  }
  if (!validateStatus(status)) {
    return res.status(400).json({ error: 'Status invalido' });
  }

  try {
    assertDateTime({ date, time });
    const current = await queryOne('SELECT id FROM appointments WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'Agendamento nao encontrado' });

    await assertAppointmentReferences(clientId, barberId, serviceId);
    await assertAvailableSlot({ barberId, serviceId, date, time, appointmentId: id, status });
    await runSql(
      'UPDATE appointments SET clientId = ?, barberId = ?, serviceId = ?, date = ?, time = ?, status = ?, notes = ? WHERE id = ?',
      [clientId, barberId, serviceId, date, time, normalizeStatus(status), notes || '', id]
    );
    res.json({ id, clientId, barberId, serviceId, date, time, status: normalizeStatus(status), notes });
  } catch (err) {
    sendError(res, err);
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
