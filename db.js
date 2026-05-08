const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'barbearia.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao abrir banco de dados:', err.message);
  } else {
    db.run('PRAGMA foreign_keys = ON');
    console.log('Banco de dados SQLite aberto em', dbPath);
  }
});

const exec = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const init = async () => {
  await exec(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS barbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT,
    phone TEXT
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    duration INTEGER NOT NULL,
    price REAL NOT NULL
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientId INTEGER NOT NULL,
    barberId INTEGER NOT NULL,
    serviceId INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Agendado',
    notes TEXT,
    FOREIGN KEY(clientId) REFERENCES clients(id),
    FOREIGN KEY(barberId) REFERENCES barbers(id),
    FOREIGN KEY(serviceId) REFERENCES services(id)
  )`);

  await exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin'
  )`);

  const defaultPassword = bcrypt.hashSync('admin123', 10);
  const count = await new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });

  if (count === 0) {
    await exec('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', defaultPassword, 'admin']);
  }
};

module.exports = {
  db,
  init
};
