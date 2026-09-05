const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ============================================================
// DATABASE
// ============================================================

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function query(text, params = []) {
  return pool.query(text, params);
}

// ============================================================
// PRICE RANGES
// ============================================================

const PRICE_RANGES = [
  [1000, 10000],
  [10000, 20000],
  [20000, 30000],
  [30000, 40000],
  [40000, 50000],
  [50000, 60000],
  [60000, 70000],
  [70000, 80000],
  [80000, 90000],
  [90000, 100000],
  [100000, 200000],
  [200000, 300000],
  [300000, 400000],
  [400000, 500000],
  [500000, 600000],
  [600000, 700000],
  [700000, 800000],
  [800000, 900000],
  [900000, 1000000]
];

function getPriceRangeLabel(price) {
  const p = Number(price) || 0;

  for (let i = 0; i < PRICE_RANGES.length; i++) {
    const [min, max] = PRICE_RANGES[i];

    if (i === 0) {
      if (p >= min && p <= max) {
        return `Rs. ${min.toLocaleString("en-LK")} – Rs. ${max.toLocaleString("en-LK")}`;
      }
    } else {
      if (p > min && p <= max) {
        return `Rs. ${min.toLocaleString("en-LK")} – Rs. ${max.toLocaleString("en-LK")}`;
      }
    }
  }

  return "Outside preset ranges";
}

// ============================================================
// PASSWORD HASHING
// ============================================================

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .pbkdf2Sync(password, salt, 120000, 64, "sha512")
    .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split(":");

    if (parts.length !== 2) return false;

    const salt = parts[0];
    const storedHash = parts[1];

    const hash = crypto
      .pbkdf2Sync(password, salt, 120000, 64, "sha512")
      .toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    return false;
  }
}

// ============================================================
// POSTGRESQL SESSION STORE
// ============================================================

class PostgreSQLSessionStore extends session.Store {
  constructor() {
    super();
  }

  async get(sid, callback) {
    try {
      const result = await query(
        `
        SELECT sess
        FROM user_sessions
        WHERE sid = $1
          AND expire > NOW()
        LIMIT 1
        `,
        [sid]
      );

      if (!result.rows.length) {
        return callback(null, null);
      }

      callback(null, result.rows[0].sess);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      const expire = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      );

      await query(
        `
        INSERT INTO user_sessions (sid, sess, expire)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (sid)
        DO UPDATE SET
          sess = EXCLUDED.sess,
          expire = EXCLUDED.expire
        `,
        [sid, JSON.stringify(sess), expire]
      );

      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await query(
        `DELETE FROM user_sessions WHERE sid = $1`,
        [sid]
      );

      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async touch(sid, sess, callback) {
    try {
      const expire = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      );

      await query(
        `
        UPDATE user_sessions
        SET sess = $2::jsonb,
            expire = $3
        WHERE sid = $1
        `,
        [sid, JSON.stringify(sess), expire]
      );

      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

// ============================================================
// SESSION
// ============================================================

app.use(
  session({
    name: "hasiya_admin_session",

    store: new PostgreSQLSessionStore(),

    secret:
      process.env.SESSION_SECRET ||
      "hasiya-account-store-session-secret-change-this",

    resave: false,
    saveUninitialized: false,

    proxy: true,

    rolling: true,

    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {
  console.log("Connecting to PostgreSQL...");

  const connection = await pool.connect();

  try {
    await connection.query("SELECT 1");

    console.log("PostgreSQL connection successful.");

    await connection.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        game TEXT DEFAULT '',
        price NUMERIC(14,2) DEFAULT 0,
        price_range TEXT DEFAULT '',
        image_url TEXT DEFAULT '',
        level TEXT DEFAULT '',
        fashion TEXT DEFAULT '',
        evo_guns TEXT DEFAULT '',
        emotes TEXT DEFAULT '',
        likes TEXT DEFAULT '',
        bind_info TEXT DEFAULT '',
        description TEXT DEFAULT '',
        featured BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'AVAILABLE',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT DEFAULT ''
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid TEXT PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      )
    `);

    await connection.query(`
      CREATE INDEX IF NOT EXISTS idx_accounts_status
      ON accounts(status)
    `);

    await connection.query(`
      CREATE INDEX IF NOT EXISTS idx_accounts_price
      ON accounts(price)
    `);

    await connection.query(`
      CREATE INDEX IF NOT EXISTS idx_accounts_featured
      ON accounts(featured)
    `);

    await connection.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expire
      ON user_sessions(expire)
    `);

    // Default settings
    const defaultSettings = {
      store_name: "HASIYA ACCOUNT STORE",
      slogan: "PREMIUM GAMING ACCOUNTS",
      secondary_slogan: "TRUSTED • SECURE • FAST",
      whatsapp_number: ""
    };

    for (const [key, value] of Object.entries(defaultSettings)) {
      await connection.query(
        `
        INSERT INTO settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING
        `,
        [key, value]
      );
    }

    // Admin account
    const adminResult = await connection.query(
      `
      SELECT id
      FROM admin_users
      WHERE username = 'admin'
      LIMIT 1
      `
    );

    if (!adminResult.rows.length) {
      const defaultPassword =
        process.env.ADMIN_PASSWORD || "geenath2009#";

      await connection.query(
        `
        INSERT INTO admin_users
        (username, password_hash)
        VALUES ($1, $2)
        `,
        ["admin", hashPassword(defaultPassword)]
      );

      console.log("Admin account created.");
      console.log("Username: admin");
    } else {
      console.log("Admin account already exists.");
    }

    console.log("PostgreSQL database schema initialized.");
    console.log("Default settings initialized.");
  } finally {
    connection.release();
  }
}

// ============================================================
// AUTH HELPERS
// ============================================================

function requireAdmin(req, res, next) {
  if (
    req.session &&
    req.session.admin &&
    req.session.admin.authenticated === true
  ) {
    return next();
  }

  return res.status(401).json({
    error: "Unauthorized",
    authenticated: false
  });
}

// ============================================================
// PUBLIC STORE API
// ============================================================

app.get("/api/store", async (req, res) => {
  try {
    const settingsResult = await query(`
      SELECT key, value
      FROM settings
    `);

    const settings = {};

    for (const row of settingsResult.rows) {
      settings[row.key] = row.value;
    }

    const accountsResult = await query(`
      SELECT COUNT(*)::int AS total
      FROM accounts
      WHERE status = 'AVAILABLE'
    `);

    res.json({
      settings,

      priceRanges: PRICE_RANGES.map(([min, max]) => ({
        min,
        max,
        label: `Rs. ${min.toLocaleString("en-LK")} – Rs. ${max.toLocaleString("en-LK")}`
      })),

      price_ranges: PRICE_RANGES.map(([min, max]) => ({
        min,
        max,
        label: `Rs. ${min.toLocaleString("en-LK")} – Rs. ${max.toLocaleString("en-LK")}`
      })),

      availableCount: accountsResult.rows[0].total
    });
  } catch (err) {
    console.error("STORE API ERROR:", err);

    res.status(500).json({
      error: "Failed to load store."
    });
  }
});

// ============================================================
// PUBLIC ACCOUNTS
// ============================================================

app.get("/api/accounts", async (req, res) => {
  try {
    const range = Number(req.query.range);
    const sold = String(req.query.sold || "") === "1";

    const params = [];
    const conditions = [];

    if (sold) {
      conditions.push(`status = 'SOLD'`);
    } else {
      conditions.push(`status = 'AVAILABLE'`);
    }

    if (
      Number.isInteger(range) &&
      range >= 0 &&
      range < PRICE_RANGES.length
    ) {
      const [min, max] = PRICE_RANGES[range];

      if (range === 0) {
        params.push(min, max);

        conditions.push(
          `(price >= $${params.length - 1} AND price <= $${params.length})`
        );
      } else {
        params.push(min, max);

        conditions.push(
          `(price > $${params.length - 1} AND price <= $${params.length})`
        );
      }
    }

    const sql = `
      SELECT
        id,
        title,
        game,
        price,
        price_range,
        image_url,
        level,
        fashion,
        evo_guns,
        emotes,
        likes,
        bind_info,
        description,
        featured,
        status,
        created_at,
        updated_at
      FROM accounts
      WHERE ${conditions.join(" AND ")}
      ORDER BY featured DESC, created_at DESC
    `;

    const result = await query(sql, params);

    res.json(result.rows);
  } catch (err) {
    console.error("PUBLIC ACCOUNTS ERROR:", err);

    res.status(500).json({
      error: "Failed to load accounts."
    });
  }
});

// ============================================================
// ADMIN LOGIN
// ============================================================

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        error: "Username and password are required."
      });
    }

    const result = await query(
      `
      SELECT id, username, password_hash
      FROM admin_users
      WHERE username = $1
      LIMIT 1
      `,
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    const admin = result.rows[0];

    if (!verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    req.session.admin = {
      authenticated: true,
      id: admin.id,
      username: admin.username
    };

    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(
      `Admin login successful: ${admin.username}`
    );

    res.json({
      success: true,
      authenticated: true,
      loggedIn: true,
      username: admin.username
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      error: "Login failed."
    });
  }
});

// ============================================================
// ADMIN SESSION CHECK
// ============================================================

app.get("/api/admin/me", (req, res) => {
  const authenticated =
    !!(
      req.session &&
      req.session.admin &&
      req.session.admin.authenticated === true
    );

  res.json({
    authenticated,
    loggedIn: authenticated,
    username:
      authenticated && req.session.admin.username
        ? req.session.admin.username
        : null
  });
});

// ============================================================
// ADMIN LOGOUT
// ============================================================

app.post("/api/admin/logout", (req, res) => {
  if (!req.session) {
    return res.json({
      success: true
    });
  }

  req.session.destroy(err => {
    if (err) {
      console.error("LOGOUT ERROR:", err);

      return res.status(500).json({
        error: "Logout failed."
      });
    }

    res.clearCookie("hasiya_admin_session", {
      httpOnly: true,
      secure: true,
      sameSite: "lax"
    });

    res.json({
      success: true
    });
  });
});

// ============================================================
// ADMIN DASHBOARD
// ============================================================

app.get(
  "/api/admin/dashboard",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE status = 'AVAILABLE'
          )::int AS available,
          COUNT(*) FILTER (
            WHERE status = 'SOLD'
          )::int AS sold,
          COUNT(*) FILTER (
            WHERE featured = TRUE
          )::int AS featured,
          COALESCE(
            SUM(price) FILTER (
              WHERE status = 'AVAILABLE'
            ),
            0
          ) AS total_listed_value
        FROM accounts
      `);

      const row = result.rows[0];

      const stats = {
        total: Number(row.total || 0),
        available: Number(row.available || 0),
        sold: Number(row.sold || 0),
        featured: Number(row.featured || 0),
        totalListedValue: Number(
          row.total_listed_value || 0
        )
      };

      res.json({
        ...stats,
        stats
      });
    } catch (err) {
      console.error("DASHBOARD ERROR:", err);

      res.status(500).json({
        error: "Failed to load dashboard."
      });
    }
  }
);

// ============================================================
// ADMIN ACCOUNTS LIST
// ============================================================

app.get(
  "/api/admin/accounts",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await query(`
        SELECT
          id,
          title,
          game,
          price,
          price_range,
          image_url,
          level,
          fashion,
          evo_guns,
          emotes,
          likes,
          bind_info,
          description,
          featured,
          status,
          created_at,
          updated_at
        FROM accounts
        ORDER BY created_at DESC
      `);

      res.json(result.rows);
    } catch (err) {
      console.error("ADMIN ACCOUNTS ERROR:", err);

      res.status(500).json({
        error: "Failed to load accounts."
      });
    }
  }
);

// ============================================================
// ADMIN CREATE ACCOUNT
// ============================================================

app.post(
  "/api/admin/accounts",
  requireAdmin,
  async (req, res) => {
    try {
      const body = req.body || {};

      const title = String(body.title || "").trim();

      if (!title) {
        return res.status(400).json({
          error: "Account title is required."
        });
      }

      const price = Number(body.price || 0);

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          error: "Invalid price."
        });
      }

      const status =
        String(body.status || "AVAILABLE")
          .toUpperCase() === "SOLD"
          ? "SOLD"
          : "AVAILABLE";

      const featured =
        body.featured === true ||
        body.featured === "1" ||
        body.featured === 1;

      const priceRange = getPriceRangeLabel(price);

      const result = await query(
        `
        INSERT INTO accounts (
          title,
          game,
          price,
          price_range,
          image_url,
          level,
          fashion,
          evo_guns,
          emotes,
          likes,
          bind_info,
          description,
          featured,
          status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14
        )
        RETURNING *
        `,
        [
          title,
          String(body.game || ""),
          price,
          priceRange,
          String(body.image_url || ""),
          String(body.level || ""),
          String(body.fashion || ""),
          String(body.evo_guns || ""),
          String(body.emotes || ""),
          String(body.likes || ""),
          String(body.bind_info || ""),
          String(body.description || ""),
          featured,
          status
        ]
      );

      console.log(
        `Account created: ${title} (#${result.rows[0].id})`
      );

      res.status(201).json({
        success: true,
        account: result.rows[0]
      });
    } catch (err) {
      console.error("CREATE ACCOUNT ERROR:", err);

      res.status(500).json({
        error: "Failed to create account."
      });
    }
  }
);

// ============================================================
// ADMIN UPDATE ACCOUNT
// ============================================================

app.put(
  "/api/admin/accounts/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid account ID."
        });
      }

      const body = req.body || {};

      const title = String(body.title || "").trim();

      if (!title) {
        return res.status(400).json({
          error: "Account title is required."
        });
      }

      const price = Number(body.price || 0);

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          error: "Invalid price."
        });
      }

      const status =
        String(body.status || "AVAILABLE")
          .toUpperCase() === "SOLD"
          ? "SOLD"
          : "AVAILABLE";

      const featured =
        body.featured === true ||
        body.featured === "1" ||
        body.featured === 1;

      const priceRange = getPriceRangeLabel(price);

      const result = await query(
        `
        UPDATE accounts
        SET
          title = $1,
          game = $2,
          price = $3,
          price_range = $4,
          image_url = $5,
          level = $6,
          fashion = $7,
          evo_guns = $8,
          emotes = $9,
          likes = $10,
          bind_info = $11,
          description = $12,
          featured = $13,
          status = $14,
          updated_at = NOW()
        WHERE id = $15
        RETURNING *
        `,
        [
          title,
          String(body.game || ""),
          price,
          priceRange,
          String(body.image_url || ""),
          String(body.level || ""),
          String(body.fashion || ""),
          String(body.evo_guns || ""),
          String(body.emotes || ""),
          String(body.likes || ""),
          String(body.bind_info || ""),
          String(body.description || ""),
          featured,
          status,
          id
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Account not found."
        });
      }

      res.json({
        success: true,
        account: result.rows[0]
      });
    } catch (err) {
      console.error("UPDATE ACCOUNT ERROR:", err);

      res.status(500).json({
        error: "Failed to update account."
      });
    }
  }
);

// ============================================================
// ADMIN DELETE ACCOUNT
// ============================================================

app.delete(
  "/api/admin/accounts/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid account ID."
        });
      }

      const result = await query(
        `
        DELETE FROM accounts
        WHERE id = $1
        RETURNING id
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Account not found."
        });
      }

      res.json({
        success: true
      });
    } catch (err) {
      console.error("DELETE ACCOUNT ERROR:", err);

      res.status(500).json({
        error: "Failed to delete account."
      });
    }
  }
);

// ============================================================
// ADMIN CHANGE STATUS
// ============================================================

app.patch(
  "/api/admin/accounts/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          error: "Invalid account ID."
        });
      }

      const status =
        String(req.body.status || "")
          .toUpperCase();

      if (!["AVAILABLE", "SOLD"].includes(status)) {
        return res.status(400).json({
          error: "Invalid status."
        });
      }

      const result = await query(
        `
        UPDATE accounts
        SET
          status = $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
        `,
        [status, id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Account not found."
        });
      }

      res.json({
        success: true,
        account: result.rows[0]
      });
    } catch (err) {
      console.error("STATUS UPDATE ERROR:", err);

      res.status(500).json({
        error: "Failed to update status."
      });
    }
  }
);

// ============================================================
// ADMIN SETTINGS
// ============================================================

app.put(
  "/api/admin/settings",
  requireAdmin,
  async (req, res) => {
    try {
      const body = req.body || {};

      const allowed = [
        "whatsapp_number",
        "store_name",
        "slogan",
        "secondary_slogan"
      ];

      for (const key of allowed) {
        if (body[key] === undefined) continue;

        await query(
          `
          INSERT INTO settings (key, value)
          VALUES ($1, $2)
          ON CONFLICT (key)
          DO UPDATE SET value = EXCLUDED.value
          `,
          [key, String(body[key] || "")]
        );
      }

      res.json({
        success: true
      });
    } catch (err) {
      console.error("SETTINGS ERROR:", err);

      res.status(500).json({
        error: "Failed to save settings."
      });
    }
  }
);

// ============================================================
// ADMIN CHANGE PASSWORD
// ============================================================

app.post(
  "/api/admin/password",
  requireAdmin,
  async (req, res) => {
    try {
      const currentPassword = String(
        req.body.currentPassword || ""
      );

      const newPassword = String(
        req.body.newPassword || ""
      );

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: "Current and new password are required."
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          error: "New password must be at least 6 characters."
        });
      }

      const adminId = req.session.admin.id;

      const result = await query(
        `
        SELECT password_hash
        FROM admin_users
        WHERE id = $1
        LIMIT 1
        `,
        [adminId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Admin account not found."
        });
      }

      if (
        !verifyPassword(
          currentPassword,
          result.rows[0].password_hash
        )
      ) {
        return res.status(401).json({
          error: "Current password is incorrect."
        });
      }

      await query(
        `
        UPDATE admin_users
        SET
          password_hash = $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [hashPassword(newPassword), adminId]
      );

      res.json({
        success: true
      });
    } catch (err) {
      console.error("PASSWORD ERROR:", err);

      res.status(500).json({
        error: "Failed to change password."
      });
    }
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get("/health", async (req, res) => {
  try {
    await query("SELECT 1");

    res.json({
      status: "ok",
      database: "PostgreSQL",
      time: new Date().toISOString()
    });
  } catch {
    res.status(500).json({
      status: "error",
      database: "PostgreSQL"
    });
  }
});

// ============================================================
// STATIC FRONTEND
// ============================================================

console.log("Project root:", ROOT);
console.log("Public directory:", PUBLIC_DIR);

app.use(express.static(PUBLIC_DIR));

// Main website
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"), err => {
    if (err) {
      console.error("index.html error:", err);

      if (!res.headersSent) {
        res.status(404).send(
          "index.html not found in public folder."
        );
      }
    }
  });
});

// Admin website
app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"), err => {
    if (err) {
      console.error("admin.html error:", err);

      if (!res.headersSent) {
        res.status(404).send(
          "admin.html not found in public folder."
        );
      }
    }
  });
});

// Also support /admin/
app.get("/admin/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"), err => {
    if (err) {
      console.error("admin.html error:", err);

      if (!res.headersSent) {
        res.status(404).send(
          "admin.html not found in public folder."
        );
      }
    }
  });
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API endpoint not found."
    });
  }

  res.status(404).send("Page not found.");
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Internal server error."
  });
});

// ============================================================
// START SERVER
// ============================================================

async function start() {
  try {
    await initializeDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `HASIYA ACCOUNT STORE running on port ${PORT}`
      );

      console.log("Database: PostgreSQL");
      console.log("Frontend: /public");
      console.log("Admin session store: PostgreSQL");
      console.log("Admin session/proxy configuration enabled.");
    });
  } catch (err) {
    console.error("STARTUP FAILED:", err);
    process.exit(1);
  }
}

start();
