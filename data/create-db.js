const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

// Existing invalid DB එක overwrite කරන්න
if (fs.existsSync(DB_FILE)) {
    fs.unlinkSync(DB_FILE);
}

const db = new Database(DB_FILE);

db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = ON");

// ACCOUNTS
db.exec(`
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT 'Free Fire',
    price REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    description TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// SETTINGS
db.exec(`
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
`);

// ADMIN
db.exec(`
CREATE TABLE admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Default admin
const insertAdmin = db.prepare(`
    INSERT INTO admin (username, password)
    VALUES (?, ?)
`);

insertAdmin.run("admin", "geenath2009#");

// Indexes
db.exec(`
CREATE INDEX idx_accounts_status
ON accounts(status);

CREATE INDEX idx_accounts_price
ON accounts(price);
`);

db.close();

console.log("=================================");
console.log(" VALID STORE.DB CREATED");
console.log("=================================");
console.log("Location:", DB_FILE);
console.log("Admin username: admin");
console.log("Admin password: geenath2009#");
console.log("=================================");
