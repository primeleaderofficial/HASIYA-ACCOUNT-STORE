const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

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

/* =========================================================
   PRICE RANGES
========================================================= */

const PRICE_RANGES = [
  { id: 1, min: 1000, max: 10000, label: "Rs. 1,000 – 10,000" },
  { id: 2, min: 10000, max: 20000, label: "Rs. 10,000 – 20,000" },
  { id: 3, min: 20000, max: 30000, label: "Rs. 20,000 – 30,000" },
  { id: 4, min: 30000, max: 40000, label: "Rs. 30,000 – 40,000" },
  { id: 5, min: 40000, max: 50000, label: "Rs. 40,000 – 50,000" },
  { id: 6, min: 50000, max: 60000, label: "Rs. 50,000 – 60,000" },
  { id: 7, min: 60000, max: 70000, label: "Rs. 60,000 – 70,000" },
  { id: 8, min: 70000, max: 80000, label: "Rs. 70,000 – 80,000" },
  { id: 9, min: 80000, max: 90000, label: "Rs. 80,000 – 90,000" },
  { id: 10, min: 90000, max: 100000, label: "Rs. 90,000 – 100,000" },
  { id: 11, min: 100000, max: 200000, label: "Rs. 100,000 – 200,000" },
  { id: 12, min: 200000, max: 300000, label: "Rs. 200,000 – 300,000" },
  { id: 13, min: 300000, max: 400000, label: "Rs. 300,000 – 400,000" },
  { id: 14, min: 400000, max: 500000, label: "Rs. 400,000 – 500,000" },
  { id: 15, min: 500000, max: 600000, label: "Rs. 500,000 – 600,000" },
  { id: 16, min: 600000, max: 700000, label: "Rs. 600,000 – 700,000" },
  { id: 17, min: 700000, max: 800000, label: "Rs. 700,000 – 800,000" },
  { id: 18, min: 800000, max: 900000, label: "Rs. 800,000 – 900,000" },
  { id: 19, min: 900000, max: 1000000, label: "Rs. 900,000 – 1,000,000" }
];

/* =========================================================
   HELPERS
========================================================= */

function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function normalizeAccount(row) {
  return {
    id: Number(row.id),
    title: row.title || "",
    game: row.game || "",
    price: Number(row.price || 0),
    image_url: row.image_url || "",
    level: row.level || "",
    fashion: row.fashion || "",
    evo_guns: row.evo_guns || "",
    emotes: row.emotes || "",
    likes: row.likes || "",
    bind_info: row.bind_info || "",
    description: row.description || "",
    featured: Boolean(row.featured),
    status: row.status || "AVAILABLE",
    created_at: row.created_at
  };
}

function hashPassword(password, salt) {
  return crypto
    .scryptSync(password, salt, 64)
    .toString("hex");
}

function createPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  return {
    salt,
    hash: hashPassword(password, salt)
  };
}

function verifyPassword(password, salt, storedHash) {
  if (!salt || !storedHash) return false;

  const calculated = hashPassword(password, salt);

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculated, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    return false;
  }
}

/* =========================================================
   POSTGRES SESSION STORE
========================================================= */

class PostgreSQLSessionStore extends session.Store {
  async get(sid, callback) {
    try {
      const result = await pool.query(
        "SELECT sess, expire FROM user_sessions WHERE sid = $1",
        [sid]
      );

      if (result.rows.length === 0) {
        return callback(null, null);
      }

      const row = result.rows[0];

      if (new Date(row.expire).getTime() <= Date.now()) {
        await pool.query(
          "DELETE FROM user_sessions WHERE sid = $1",
          [sid]
        );

        return callback(null, null);
      }

      callback(null, row.sess);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid, sess, callback) {
    try {
      let expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      if (sess.cookie && sess.cookie.expires) {
        expire = new Date(sess.cookie.expires);
      }

      await pool.query(
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
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await pool.query(
        "DELETE FROM user_sessions WHERE sid = $1",
        [sid]
      );

      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async touch(sid, sess, callback) {
    try {
      let expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      if (sess.cookie && sess.cookie.expires) {
        expire = new Date(sess.cookie.expires);
      }

      await pool.query(
        "UPDATE user_sessions SET expire = $2 WHERE sid = $1",
        [sid, expire]
      );

      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

/* =========================================================
   SESSION
========================================================= */

app.use(
  session({
    store: new PostgreSQLSessionStore(),
    secret:
      process.env.SESSION_SECRET ||
      "hasiya-account-store-session-secret-change-this",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    name: "hasiya_admin_session",
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initDatabase() {
  console.log("Connecting to PostgreSQL...");

  await pool.query("SELECT 1");

  console.log("PostgreSQL connection successful.");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT 'Free Fire',
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      image_url TEXT DEFAULT '',
      level TEXT DEFAULT '',
      fashion TEXT DEFAULT '',
      evo_guns TEXT DEFAULT '',
      emotes TEXT DEFAULT '',
      likes TEXT DEFAULT '',
      bind_info TEXT DEFAULT '',
      description TEXT DEFAULT '',
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid TEXT PRIMARY KEY,
      sess JSONB NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
    ON user_sessions(expire)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS accounts_status_idx
    ON accounts(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS accounts_price_idx
    ON accounts(price)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS accounts_featured_idx
    ON accounts(featured)
  `);

  /* Default settings */

  const settings = [
    ["store_name", "HASIYA ACCOUNT STORE"],
    ["slogan", "Premium Gaming Accounts"],
    ["secondary_slogan", "Trusted • Secure • Fast"],
    ["whatsapp_number", ""]
  ];

  for (const [key, value] of settings) {
    await pool.query(
      `
      INSERT INTO settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
      `,
      [key, value]
    );
  }

  /* Default admin */

  const adminResult = await pool.query(
    "SELECT id FROM admin_users WHERE username = $1",
    ["admin"]
  );

  if (adminResult.rows.length === 0) {
    const defaultPassword =
      process.env.ADMIN_PASSWORD || "geenath2009#";

    const password = createPassword(defaultPassword);

    await pool.query(
      `
      INSERT INTO admin_users
      (username, password_hash, password_salt)
      VALUES ($1, $2, $3)
      `,
      [
        "admin",
        password.hash,
        password.salt
      ]
    );

    console.log("Admin account created.");
    console.log("Username: admin");
  }

  /* Remove expired sessions */

  await pool.query(
    "DELETE FROM user_sessions WHERE expire < NOW()"
  );

  console.log("PostgreSQL database schema initialized.");
  console.log("Default settings initialized.");
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireAdmin(req, res, next) {
  if (
    req.session &&
    req.session.admin &&
    req.session.admin.authenticated === true
  ) {
    return next();
  }

  return res.status(401).json({
    success: false,
    authenticated: false,
    error: "Unauthorized"
  });
}

/* =========================================================
   PUBLIC STORE API
========================================================= */

app.get(
  "/api/store",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT key, value FROM settings ORDER BY key"
    );

    const settings = {};

    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    res.json({
      success: true,
      settings,
      priceRanges: PRICE_RANGES,
      price_ranges: PRICE_RANGES
    });
  })
);

/* =========================================================
   PUBLIC ACCOUNTS
========================================================= */

app.get(
  "/api/accounts",
  asyncHandler(async (req, res) => {
    const sold =
      String(req.query.sold || "") === "1" ||
      String(req.query.status || "").toUpperCase() === "SOLD";

    const range = Number(req.query.range || 0);

    let sql = `
      SELECT *
      FROM accounts
      WHERE status = $1
    `;

    const params = [sold ? "SOLD" : "AVAILABLE"];

    if (!sold && range > 0) {
      const selectedRange = PRICE_RANGES.find(
        r => r.id === range
      );

      if (selectedRange) {
        sql += `
          AND price >= $2
          AND price <= $3
        `;

        params.push(
          selectedRange.min,
          selectedRange.max
        );
      }
    }

    if (!sold) {
      sql += `
        ORDER BY featured DESC, created_at DESC, id DESC
      `;
    } else {
      sql += `
        ORDER BY created_at DESC, id DESC
      `;
    }

    const result = await pool.query(sql, params);

    const accounts = result.rows.map(normalizeAccount);

    res.json({
      success: true,
      accounts,
      data: accounts,
      total: accounts.length
    });
  })
);

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
  "/api/admin/login",
  asyncHandler(async (req, res) => {
    const username = String(
      req.body.username || ""
    ).trim();

    const password = String(
      req.body.password || ""
    );

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        authenticated: false,
        error: "Username and password are required."
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM admin_users
      WHERE username = $1
      LIMIT 1
      `,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: "Invalid username or password."
      });
    }

    const admin = result.rows[0];

    const valid = verifyPassword(
      password,
      admin.password_salt,
      admin.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: "Invalid username or password."
      });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate(error => {
        if (error) reject(error);
        else resolve();
      });
    });

    req.session.admin = {
      authenticated: true,
      id: admin.id,
      username: admin.username,
      loginTime: Date.now()
    };

    await new Promise((resolve, reject) => {
      req.session.save(error => {
        if (error) reject(error);
        else resolve();
      });
    });

    console.log(
      `Admin login successful: ${username}`
    );

    res.json({
      success: true,
      authenticated: true,
      loggedIn: true,
      username: admin.username
    });
  })
);

/* =========================================================
   ADMIN ME
========================================================= */

app.get(
  "/api/admin/me",
  (req, res) => {
    const authenticated =
      Boolean(
        req.session &&
        req.session.admin &&
        req.session.admin.authenticated === true
      );

    res.json({
      success: true,
      authenticated,
      loggedIn: authenticated,
      admin: authenticated
        ? req.session.admin
        : null
    });
  }
);

/* =========================================================
   ADMIN LOGOUT
========================================================= */

app.post(
  "/api/admin/logout",
  asyncHandler(async (req, res) => {
    await new Promise(resolve => {
      if (!req.session) {
        return resolve();
      }

      req.session.destroy(() => resolve());
    });

    res.clearCookie("hasiya_admin_session", {
      httpOnly: true,
      secure: true,
      sameSite: "lax"
    });

    res.json({
      success: true,
      authenticated: false
    });
  })
);

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

app.get(
  "/api/admin/dashboard",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
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
        COALESCE(SUM(price), 0) AS total_value
      FROM accounts
    `);

    const row = result.rows[0];

    const dashboard = {
      total: Number(row.total || 0),
      available: Number(row.available || 0),
      sold: Number(row.sold || 0),
      featured: Number(row.featured || 0),
      totalListedValue: Number(row.total_value || 0)
    };

    res.json({
      success: true,
      ...dashboard,
      dashboard
    });
  })
);

/* =========================================================
   ADMIN ACCOUNTS LIST
========================================================= */

app.get(
  "/api/admin/accounts",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT *
      FROM accounts
      ORDER BY created_at DESC, id DESC
    `);

    const accounts = result.rows.map(normalizeAccount);

    res.json({
      success: true,
      accounts,
      data: accounts
    });
  })
);

/* =========================================================
   VALIDATE ACCOUNT
========================================================= */

function accountPayload(body) {
  return {
    title: String(body.title || "").trim(),
    game: String(body.game || "Free Fire").trim(),
    price: Number(body.price || 0),
    image_url: String(body.image_url || "").trim(),
    level: String(body.level || "").trim(),
    fashion: String(body.fashion || "").trim(),
    evo_guns: String(body.evo_guns || "").trim(),
    emotes: String(body.emotes || "").trim(),
    likes: String(body.likes || "").trim(),
    bind_info: String(body.bind_info || "").trim(),
    description: String(body.description || "").trim(),
    featured:
      body.featured === true ||
      body.featured === "true" ||
      body.featured === "1",
    status:
      String(body.status || "AVAILABLE").toUpperCase() === "SOLD"
        ? "SOLD"
        : "AVAILABLE"
  };
}

/* =========================================================
   ADD ACCOUNT
========================================================= */

app.post(
  "/api/admin/accounts",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const a = accountPayload(req.body);

    if (!a.title) {
      return res.status(400).json({
        success: false,
        error: "Account title is required."
      });
    }

    if (!Number.isFinite(a.price) || a.price < 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid price."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO accounts (
        title,
        game,
        price,
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      RETURNING *
      `,
      [
        a.title,
        a.game,
        a.price,
        a.image_url,
        a.level,
        a.fashion,
        a.evo_guns,
        a.emotes,
        a.likes,
        a.bind_info,
        a.description,
        a.featured,
        a.status
      ]
    );

    res.json({
      success: true,
      account: normalizeAccount(result.rows[0])
    });
  })
);

/* =========================================================
   EDIT ACCOUNT
========================================================= */

app.put(
  "/api/admin/accounts/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid account ID."
      });
    }

    const a = accountPayload(req.body);

    if (!a.title) {
      return res.status(400).json({
        success: false,
        error: "Account title is required."
      });
    }

    const result = await pool.query(
      `
      UPDATE accounts
      SET
        title = $1,
        game = $2,
        price = $3,
        image_url = $4,
        level = $5,
        fashion = $6,
        evo_guns = $7,
        emotes = $8,
        likes = $9,
        bind_info = $10,
        description = $11,
        featured = $12,
        status = $13
      WHERE id = $14
      RETURNING *
      `,
      [
        a.title,
        a.game,
        a.price,
        a.image_url,
        a.level,
        a.fashion,
        a.evo_guns,
        a.emotes,
        a.likes,
        a.bind_info,
        a.description,
        a.featured,
        a.status,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Account not found."
      });
    }

    res.json({
      success: true,
      account: normalizeAccount(result.rows[0])
    });
  })
);

/* =========================================================
   CHANGE STATUS
========================================================= */

app.patch(
  "/api/admin/accounts/:id/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    const status =
      String(req.body.status || "")
        .toUpperCase() === "SOLD"
        ? "SOLD"
        : "AVAILABLE";

    const result = await pool.query(
      `
      UPDATE accounts
      SET status = $1
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Account not found."
      });
    }

    res.json({
      success: true,
      account: normalizeAccount(result.rows[0])
    });
  })
);

/* =========================================================
   DELETE ACCOUNT
========================================================= */

app.delete(
  "/api/admin/accounts/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM accounts
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Account not found."
      });
    }

    res.json({
      success: true,
      deleted: true
    });
  })
);

/* =========================================================
   SETTINGS UPDATE
========================================================= */

app.put(
  "/api/admin/settings",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const values = {
      whatsapp_number: String(
        req.body.whatsapp_number || ""
      ).trim(),

      store_name: String(
        req.body.store_name || ""
      ).trim(),

      slogan: String(
        req.body.slogan || ""
      ).trim(),

      secondary_slogan: String(
        req.body.secondary_slogan || ""
      ).trim()
    };

    for (const [key, value] of Object.entries(values)) {
      await pool.query(
        `
        INSERT INTO settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value
        `,
        [key, value]
      );
    }

    res.json({
      success: true
    });
  })
);

/* =========================================================
   CHANGE PASSWORD
========================================================= */

app.post(
  "/api/admin/password",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const currentPassword = String(
      req.body.currentPassword || ""
    );

    const newPassword = String(
      req.body.newPassword || ""
    );

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters."
      });
    }

    const adminId = req.session.admin.id;

    const result = await pool.query(
      `
      SELECT *
      FROM admin_users
      WHERE id = $1
      LIMIT 1
      `,
      [adminId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Admin account not found."
      });
    }

    const admin = result.rows[0];

    const valid = verifyPassword(
      currentPassword,
      admin.password_salt,
      admin.password_hash
    );

    if (!valid) {
      return res.status(400).json({
        success: false,
        error: "Current password is incorrect."
      });
    }

    const password = createPassword(newPassword);

    await pool.query(
      `
      UPDATE admin_users
      SET
        password_hash = $1,
        password_salt = $2
      WHERE id = $3
      `,
      [
        password.hash,
        password.salt,
        adminId
      ]
    );

    res.json({
      success: true
    });
  })
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  asyncHandler(async (req, res) => {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "postgresql"
    });
  })
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    path.join(__dirname),
    {
      index: "index.html"
    }
  )
);

/* =========================================================
   ADMIN PAGE
========================================================= */

app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin.html")
  );
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    success: false,
    error: "Internal server error."
  });
});

/* =========================================================
   START
========================================================= */

async function start() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `HASIYA ACCOUNT STORE running on port ${PORT}`
      );
      console.log(
        "Database: PostgreSQL"
      );
      console.log(
        "Persistent PostgreSQL sessions enabled."
      );
    });
  } catch (error) {
    console.error(
      "DATABASE STARTUP FAILED:"
    );
    console.error(error);
    process.exit(1);
  }
}

start();
