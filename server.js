```js
const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const helmet = require("helmet");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

/* =========================================================
   RENDER / PROXY
========================================================= */

app.set("trust proxy", 1);

/* =========================================================
   DATABASE
========================================================= */

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================================================
   POSTGRES SESSION STORE
========================================================= */

class PostgreSQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async get(sid, callback) {
    try {
      const result = await this.pool.query(
        "SELECT sess FROM user_sessions WHERE sid = $1 AND expire > NOW()",
        [sid]
      );

      if (result.rows.length === 0) {
        return callback(null, null);
      }

      callback(null, result.rows[0].sess);
    } catch (err) {
      console.error("SESSION GET ERROR:", err);
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      const expireMs =
        sess.cookie && sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + 1000 * 60 * 60 * 24 * 7;

      const expire = new Date(expireMs);

      await this.pool.query(
        `
        INSERT INTO user_sessions (sid, sess, expire)
        VALUES ($1, $2::jsonb, $3)
        ON CONFLICT (sid)
        DO UPDATE SET
          sess = EXCLUDED.sess,
          expire = EXCLUDED.expire
        `,
        [
          sid,
          JSON.stringify(sess),
          expire
        ]
      );

      callback(null);
    } catch (err) {
      console.error("SESSION SET ERROR:", err);
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.pool.query(
        "DELETE FROM user_sessions WHERE sid = $1",
        [sid]
      );

      callback(null);
    } catch (err) {
      console.error("SESSION DESTROY ERROR:", err);
      callback(err);
    }
  }

  async touch(sid, sess, callback) {
    try {
      const expireMs =
        sess.cookie && sess.cookie.expires
          ? new Date(sess.cookie.expires).getTime()
          : Date.now() + 1000 * 60 * 60 * 24 * 7;

      await this.pool.query(
        "UPDATE user_sessions SET expire = $1 WHERE sid = $2",
        [new Date(expireMs), sid]
      );

      callback(null);
    } catch (err) {
      console.error("SESSION TOUCH ERROR:", err);
      callback(err);
    }
  }

  async clear(callback) {
    try {
      await this.pool.query("DELETE FROM user_sessions");
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

/* =========================================================
   SESSION
========================================================= */

app.use(
  session({
    name: "hasiya_admin_session",

    secret:
      process.env.SESSION_SECRET ||
      "HASIYA_ACCOUNT_STORE_SESSION_SECRET_2026_CHANGE_THIS",

    store: new PostgreSQLSessionStore(pool),

    resave: false,

    saveUninitialized: false,

    rolling: true,

    proxy: true,

    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

/* =========================================================
   PRICE RANGES
========================================================= */

const PRICE_RANGES = [
  [1, 1000, 10000],
  [2, 10000, 20000],
  [3, 20000, 30000],
  [4, 30000, 40000],
  [5, 40000, 50000],
  [6, 50000, 60000],
  [7, 60000, 70000],
  [8, 70000, 80000],
  [9, 80000, 90000],
  [10, 90000, 100000],
  [11, 100000, 200000],
  [12, 200000, 300000],
  [13, 300000, 400000],
  [14, 400000, 500000],
  [15, 500000, 600000],
  [16, 600000, 700000],
  [17, 700000, 800000],
  [18, 800000, 900000],
  [19, 900000, 1000000]
];

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        game TEXT NOT NULL,
        price INTEGER NOT NULL DEFAULT 0 CHECK(price >= 0),
        image_url TEXT NOT NULL,
        level TEXT DEFAULT '',
        fashion TEXT DEFAULT '',
        evo_guns TEXT DEFAULT '',
        emotes TEXT DEFAULT '',
        likes TEXT DEFAULT '',
        bind_info TEXT DEFAULT '',
        description TEXT DEFAULT '',
        featured INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'AVAILABLE'
          CHECK(status IN ('AVAILABLE', 'SOLD')),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
      )
    `);

    /* Persistent PostgreSQL sessions */
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid TEXT PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMP NOT NULL
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
      ON user_sessions(expire)
    `);

    await client.query("COMMIT");

    console.log("PostgreSQL database schema initialized.");
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Database initialization failed:", err);

    throw err;
  } finally {
    client.release();
  }
}

/* =========================================================
   PASSWORD
========================================================= */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash || "").split(":");

    if (parts.length !== 2) {
      return false;
    }

    const salt = parts[0];
    const originalHash = parts[1];

    const hash = crypto
      .scryptSync(password, salt, 64)
      .toString("hex");

    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(originalHash, "hex");

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* =========================================================
   DEFAULT SETTINGS
========================================================= */

async function initSettings() {
  const defaults = {
    whatsapp_number: "",
    store_name: "HASIYA ACCOUNT STORE",
    slogan: "හොරුන්ට අහු වූ කාලේ ඉවරයි.",
    secondary_slogan:
      "100% විශ්වාසවන්ත ලෙස Account වැඩ කරගැනීමට අප සමඟ එකතු වන්න."
  };

  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      `
      INSERT INTO settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO NOTHING
      `,
      [key, value]
    );
  }

  console.log("Default settings initialized.");
}

/* =========================================================
   DEFAULT ADMIN
========================================================= */

async function initAdmin() {
  const result = await pool.query(
    "SELECT id, username FROM admin WHERE id = 1"
  );

  if (result.rows.length === 0) {
    const username = "admin";

    /*
      Default password.
      Change it from Admin Dashboard after login.
    */
    const password = "geenath2009#";

    const passwordHash = hashPassword(password);

    await pool.query(
      `
      INSERT INTO admin
      (id, username, password_hash)
      VALUES (1, $1, $2)
      `,
      [username, passwordHash]
    );

    console.log("Admin account created.");
    console.log("Username: admin");
    console.log("Default admin password configured.");
  } else {
    console.log(
      "Admin account already exists:",
      result.rows[0].username
    );
  }
}

/* =========================================================
   SETTINGS
========================================================= */

async function getSettings() {
  const result = await pool.query(
    "SELECT key, value FROM settings ORDER BY key"
  );

  const settings = {};

  for (const row of result.rows) {
    settings[row.key] = row.value;
  }

  return settings;
}

/* =========================================================
   HELPERS
========================================================= */

function cleanString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function cleanNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.round(number));
}

function driveToImageUrl(url) {
  if (!url) {
    return "";
  }

  url = String(url).trim();

  const fileMatch = url.match(
    /drive\.google\.com\/file\/d\/([^/]+)/
  );

  if (fileMatch) {
    return (
      "https://drive.google.com/uc?export=view&id=" +
      fileMatch[1]
    );
  }

  const openMatch = url.match(
    /drive\.google\.com\/open\?id=([^&]+)/
  );

  if (openMatch) {
    return (
      "https://drive.google.com/uc?export=view&id=" +
      openMatch[1]
    );
  }

  return url;
}

function normalizeAccount(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    image_url: driveToImageUrl(row.image_url),
    featured:
      Number(row.featured) === 1 ||
      row.featured === true
  };
}

/* =========================================================
   RANGE PARSER
========================================================= */

function getRangeValues(range) {
  if (
    range === undefined ||
    range === null ||
    String(range) === "" ||
    String(range).toLowerCase() === "all"
  ) {
    return null;
  }

  const index = Number(range);

  if (!Number.isInteger(index)) {
    return null;
  }

  const found = PRICE_RANGES.find(
    (item) => Number(item[0]) === index
  );

  if (!found) {
    return null;
  }

  return {
    min: Number(found[1]),
    max: Number(found[2])
  };
}

/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(req, res, next) {
  const admin =
    req.session &&
    req.session.admin
      ? req.session.admin
      : null;

  console.log(
    "ADMIN AUTH:",
    admin ? admin.username : "NOT LOGGED IN"
  );

  if (!admin) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized. Admin login required.",
      message: "Unauthorized. Admin login required."
    });
  }

  next();
}

/* =========================================================
   PUBLIC STORE
========================================================= */

app.get("/api/store", async (req, res) => {
  try {
    const settings = await getSettings();

    res.json({
      success: true,

      settings,

      /* Both formats supported */
      priceRanges: PRICE_RANGES,

      price_ranges: PRICE_RANGES
    });
  } catch (err) {
    console.error("Store API error:", err);

    res.status(500).json({
      success: false,
      error: "Could not load store settings.",
      message: "Could not load store settings."
    });
  }
});

/* =========================================================
   PUBLIC ACCOUNTS
========================================================= */

app.get("/api/accounts", async (req, res) => {
  try {
    const sold =
      String(req.query.sold || "") === "1";

    let sql = `
      SELECT *
      FROM accounts
      WHERE status = $1
    `;

    const params = [
      sold ? "SOLD" : "AVAILABLE"
    ];

    /* PRICE RANGE */

    const range =
      getRangeValues(req.query.range);

    if (range) {
      params.push(range.min);
      sql += ` AND price >= $${params.length}`;

      params.push(range.max);
      sql += ` AND price <= $${params.length}`;
    }

    /* Optional direct min/max */

    if (req.query.minPrice !== undefined) {
      const minPrice = Number(req.query.minPrice);

      if (Number.isFinite(minPrice)) {
        params.push(minPrice);
        sql += ` AND price >= $${params.length}`;
      }
    }

    if (req.query.maxPrice !== undefined) {
      const maxPrice = Number(req.query.maxPrice);

      if (Number.isFinite(maxPrice)) {
        params.push(maxPrice);
        sql += ` AND price <= $${params.length}`;
      }
    }

    sql += `
      ORDER BY
        featured DESC,
        created_at DESC
    `;

    const result = await pool.query(
      sql,
      params
    );

    const accounts =
      result.rows.map(normalizeAccount);

    res.json({
      success: true,
      accounts,

      /* Also expose data for frontend compatibility */
      data: accounts
    });
  } catch (err) {
    console.error("Public accounts error:", err);

    res.status(500).json({
      success: false,
      error: "Could not load accounts.",
      message: "Could not load accounts."
    });
  }
});

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post("/api/admin/login", async (req, res) => {
  try {
    const username =
      cleanString(req.body.username);

    const password =
      cleanString(req.body.password);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required.",
        message: "Username and password are required."
      });
    }

    const result = await pool.query(
      "SELECT * FROM admin WHERE username = $1",
      [username]
    );

    const admin = result.rows[0];

    if (!admin) {
      console.log(
        "ADMIN LOGIN FAILED: username not found"
      );

      return res.status(401).json({
        success: false,
        error: "Invalid username or password.",
        message: "Invalid username or password."
      });
    }

    if (
      !verifyPassword(
        password,
        admin.password_hash
      )
    ) {
      console.log(
        "ADMIN LOGIN FAILED: wrong password"
      );

      return res.status(401).json({
        success: false,
        error: "Invalid username or password.",
        message: "Invalid username or password."
      });
    }

    /*
      Destroy old session and create a new one.
    */

    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        console.error(
          "SESSION REGENERATE ERROR:",
          regenerateError
        );

        return res.status(500).json({
          success: false,
          error: "Could not create login session.",
          message: "Could not create login session."
        });
      }

      req.session.admin = {
        id: admin.id,
        username: admin.username
      };

      req.session.save((saveError) => {
        if (saveError) {
          console.error(
            "SESSION SAVE ERROR:",
            saveError
          );

          return res.status(500).json({
            success: false,
            error: "Could not save login session.",
            message: "Could not save login session."
          });
        }

        console.log(
          "ADMIN LOGIN SUCCESS:",
          admin.username
        );

        console.log(
          "SESSION ID:",
          req.sessionID
        );

        res.json({
          success: true,
          message: "Login successful.",

          authenticated: true,
          loggedIn: true,

          admin: {
            id: admin.id,
            username: admin.username
          }
        });
      });
    });
  } catch (err) {
    console.error("Login error:", err);

    res.status(500).json({
      success: false,
      error: "Login failed.",
      message: "Login failed."
    });
  }
});

/* =========================================================
   SESSION CHECK
========================================================= */

app.get("/api/admin/me", (req, res) => {
  const loggedIn =
    Boolean(
      req.session &&
      req.session.admin
    );

  console.log(
    "ADMIN ME:",
    loggedIn
      ? req.session.admin.username
      : "NOT LOGGED IN"
  );

  if (!loggedIn) {
    return res.json({
      success: true,
      authenticated: false,
      loggedIn: false,
      admin: null
    });
  }

  res.json({
    success: true,

    authenticated: true,
    loggedIn: true,

    admin: req.session.admin
  });
});

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/admin/logout", (req, res) => {
  if (!req.session) {
    return res.json({
      success: true,
      message: "Logged out."
    });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error(
        "Logout error:",
        err
      );

      return res.status(500).json({
        success: false,
        error: "Logout failed.",
        message: "Logout failed."
      });
    }

    res.clearCookie(
      "hasiya_admin_session",
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax"
      }
    );

    res.json({
      success: true,
      message: "Logged out."
    });
  });
});

/* =========================================================
   DASHBOARD
========================================================= */

app.get(
  "/api/admin/dashboard",
  requireAdmin,
  async (req, res) => {
    try {
      const totalResult =
        await pool.query(
          "SELECT COUNT(*)::integer AS count FROM accounts"
        );

      const availableResult =
        await pool.query(
          `
          SELECT COUNT(*)::integer AS count
          FROM accounts
          WHERE status = 'AVAILABLE'
          `
        );

      const soldResult =
        await pool.query(
          `
          SELECT COUNT(*)::integer AS count
          FROM accounts
          WHERE status = 'SOLD'
          `
        );

      const featuredResult =
        await pool.query(
          `
          SELECT COUNT(*)::integer AS count
          FROM accounts
          WHERE featured = 1
          AND status = 'AVAILABLE'
          `
        );

      const valueResult =
        await pool.query(
          `
          SELECT COALESCE(
            SUM(price)
            FILTER (WHERE status = 'AVAILABLE'),
            0
          )::bigint AS total
          FROM accounts
          `
        );

      const total =
        Number(totalResult.rows[0].count);

      const available =
        Number(availableResult.rows[0].count);

      const sold =
        Number(soldResult.rows[0].count);

      const featured =
        Number(featuredResult.rows[0].count);

      const totalListedValue =
        Number(valueResult.rows[0].total || 0);

      const dashboard = {
        total,
        available,
        sold,
        featured,
        totalListedValue
      };

      /*
        Return BOTH formats so old/new admin.js
        versions work.
      */

      res.json({
        success: true,

        total,
        available,
        sold,
        featured,
        totalListedValue,

        dashboard
      });
    } catch (err) {
      console.error(
        "Dashboard error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not load dashboard.",
        message: "Could not load dashboard."
      });
    }
  }
);

/* =========================================================
   ADMIN GET ACCOUNTS
========================================================= */

app.get(
  "/api/admin/accounts",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT *
          FROM accounts
          ORDER BY created_at DESC
          `
        );

      const accounts =
        result.rows.map(normalizeAccount);

      res.json({
        success: true,
        accounts,
        data: accounts
      });
    } catch (err) {
      console.error(
        "Admin accounts error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not load accounts.",
        message: "Could not load accounts."
      });
    }
  }
);

/* =========================================================
   ADMIN CREATE ACCOUNT
========================================================= */

app.post(
  "/api/admin/accounts",
  requireAdmin,
  async (req, res) => {
    try {
      console.log(
        "CREATE ACCOUNT REQUEST RECEIVED"
      );

      const body = req.body || {};

      const title =
        cleanString(body.title);

      const game =
        cleanString(body.game);

      const price =
        cleanNumber(body.price);

      const imageUrl =
        driveToImageUrl(
          cleanString(
            body.image_url ||
            body.imageUrl ||
            body.image
          )
        );

      const level =
        cleanString(body.level);

      const fashion =
        cleanString(body.fashion);

      const evoGuns =
        cleanString(
          body.evo_guns ||
          body.evoGuns
        );

      const emotes =
        cleanString(body.emotes);

      const likes =
        cleanString(body.likes);

      const bindInfo =
        cleanString(
          body.bind_info ||
          body.bindInfo
        );

      const description =
        cleanString(body.description);

      const featured =
        body.featured === true ||
        body.featured === 1 ||
        body.featured === "1"
          ? 1
          : 0;

      const status =
        String(body.status).toUpperCase() === "SOLD"
          ? "SOLD"
          : "AVAILABLE";

      if (!title) {
        return res.status(400).json({
          success: false,
          error: "Account title is required.",
          message: "Account title is required."
        });
      }

      if (!game) {
        return res.status(400).json({
          success: false,
          error: "Game is required.",
          message: "Game is required."
        });
      }

      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          error: "Image URL is required.",
          message: "Image URL is required."
        });
      }

      const result =
        await pool.query(
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
            $1,$2,$3,$4,$5,$6,$7,
            $8,$9,$10,$11,$12,$13
          )
          RETURNING *
          `,
          [
            title,
            game,
            price,
            imageUrl,
            level,
            fashion,
            evoGuns,
            emotes,
            likes,
            bindInfo,
            description,
            featured,
            status
          ]
        );

      console.log(
        "ACCOUNT CREATED:",
        result.rows[0].id
      );

      res.status(201).json({
        success: true,
        message: "Account created.",
        account:
          normalizeAccount(
            result.rows[0]
          )
      });
    } catch (err) {
      console.error(
        "Create account error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not create account.",
        message: "Could not create account."
      });
    }
  }
);

/* =========================================================
   ADMIN UPDATE ACCOUNT
========================================================= */

app.put(
  "/api/admin/accounts/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid account ID.",
          message: "Invalid account ID."
        });
      }

      const existingResult =
        await pool.query(
          "SELECT * FROM accounts WHERE id = $1",
          [id]
        );

      const existing =
        existingResult.rows[0];

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: "Account not found.",
          message: "Account not found."
        });
      }

      const body = req.body || {};

      const title =
        body.title !== undefined
          ? cleanString(body.title)
          : existing.title;

      const game =
        body.game !== undefined
          ? cleanString(body.game)
          : existing.game;

      const price =
        body.price !== undefined
          ? cleanNumber(body.price)
          : existing.price;

      const imageUrl =
        body.image_url !== undefined ||
        body.imageUrl !== undefined ||
        body.image !== undefined
          ? driveToImageUrl(
              cleanString(
                body.image_url ||
                body.imageUrl ||
                body.image
              )
            )
          : existing.image_url;

      const level =
        body.level !== undefined
          ? cleanString(body.level)
          : existing.level;

      const fashion =
        body.fashion !== undefined
          ? cleanString(body.fashion)
          : existing.fashion;

      const evoGuns =
        body.evo_guns !== undefined ||
        body.evoGuns !== undefined
          ? cleanString(
              body.evo_guns ||
              body.evoGuns
            )
          : existing.evo_guns;

      const emotes =
        body.emotes !== undefined
          ? cleanString(body.emotes)
          : existing.emotes;

      const likes =
        body.likes !== undefined
          ? cleanString(body.likes)
          : existing.likes;

      const bindInfo =
        body.bind_info !== undefined ||
        body.bindInfo !== undefined
          ? cleanString(
              body.bind_info ||
              body.bindInfo
            )
          : existing.bind_info;

      const description =
        body.description !== undefined
          ? cleanString(body.description)
          : existing.description;

      let featured =
        Number(existing.featured) === 1
          ? 1
          : 0;

      if (body.featured !== undefined) {
        featured =
          body.featured === true ||
          body.featured === 1 ||
          body.featured === "1"
            ? 1
            : 0;
      }

      const status =
        body.status !== undefined
          ? String(body.status).toUpperCase() === "SOLD"
            ? "SOLD"
            : "AVAILABLE"
          : existing.status;

      if (!title || !game || !imageUrl) {
        return res.status(400).json({
          success: false,
          error: "Title, game and image are required.",
          message: "Title, game and image are required."
        });
      }

      const result =
        await pool.query(
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
            status = $13,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $14
          RETURNING *
          `,
          [
            title,
            game,
            price,
            imageUrl,
            level,
            fashion,
            evoGuns,
            emotes,
            likes,
            bindInfo,
            description,
            featured,
            status,
            id
          ]
        );

      res.json({
        success: true,
        message: "Account updated.",
        account:
          normalizeAccount(
            result.rows[0]
          )
      });
    } catch (err) {
      console.error(
        "Update account error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not update account.",
        message: "Could not update account."
      });
    }
  }
);

/* =========================================================
   ADMIN DELETE ACCOUNT
========================================================= */

app.delete(
  "/api/admin/accounts/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid account ID.",
          message: "Invalid account ID."
        });
      }

      const result =
        await pool.query(
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
          error: "Account not found.",
          message: "Account not found."
        });
      }

      res.json({
        success: true,
        message: "Account deleted."
      });
    } catch (err) {
      console.error(
        "Delete account error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not delete account.",
        message: "Could not delete account."
      });
    }
  }
);

/* =========================================================
   ADMIN STATUS
========================================================= */

app.patch(
  "/api/admin/accounts/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid account ID.",
          message: "Invalid account ID."
        });
      }

      const status =
        String(req.body.status).toUpperCase() === "SOLD"
          ? "SOLD"
          : "AVAILABLE";

      const result =
        await pool.query(
          `
          UPDATE accounts
          SET
            status = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *
          `,
          [status, id]
        );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Account not found.",
          message: "Account not found."
        });
      }

      res.json({
        success: true,
        message: "Status updated.",
        account:
          normalizeAccount(
            result.rows[0]
          )
      });
    } catch (err) {
      console.error(
        "Status update error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not update status.",
        message: "Could not update status."
      });
    }
  }
);

/* =========================================================
   ADMIN SETTINGS GET
========================================================= */

app.get(
  "/api/admin/settings",
  requireAdmin,
  async (req, res) => {
    try {
      res.json({
        success: true,
        settings:
          await getSettings()
      });
    } catch (err) {
      console.error(
        "Settings load error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not load settings.",
        message: "Could not load settings."
      });
    }
  }
);

/* =========================================================
   ADMIN SETTINGS UPDATE
========================================================= */

app.put(
  "/api/admin/settings",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const body =
        req.body || {};

      const allowedKeys = [
        "whatsapp_number",
        "store_name",
        "slogan",
        "secondary_slogan"
      ];

      await client.query(
        "BEGIN"
      );

      for (const key of allowedKeys) {
        if (body[key] !== undefined) {
          await client.query(
            `
            INSERT INTO settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key)
            DO UPDATE SET value = EXCLUDED.value
            `,
            [
              key,
              cleanString(body[key])
            ]
          );
        }
      }

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        message: "Settings updated.",
        settings:
          await getSettings()
      });
    } catch (err) {
      await client.query(
        "ROLLBACK"
      );

      console.error(
        "Settings update error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not update settings.",
        message: "Could not update settings."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   CHANGE PASSWORD
========================================================= */

app.post(
  "/api/admin/password",
  requireAdmin,
  async (req, res) => {
    try {
      const currentPassword =
        cleanString(
          req.body.currentPassword
        );

      const newPassword =
        cleanString(
          req.body.newPassword
        );

      if (
        !currentPassword ||
        !newPassword
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Current and new password are required.",
          message:
            "Current and new password are required."
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error:
            "New password must be at least 6 characters.",
          message:
            "New password must be at least 6 characters."
        });
      }

      const result =
        await pool.query(
          "SELECT * FROM admin WHERE id = 1"
        );

      const admin =
        result.rows[0];

      if (!admin) {
        return res.status(500).json({
          success: false,
          error: "Admin account not found.",
          message: "Admin account not found."
        });
      }

      if (
        !verifyPassword(
          currentPassword,
          admin.password_hash
        )
      ) {
        return res.status(401).json({
          success: false,
          error:
            "Current password is incorrect.",
          message:
            "Current password is incorrect."
        });
      }

      const newHash =
        hashPassword(newPassword);

      await pool.query(
        `
        UPDATE admin
        SET password_hash = $1
        WHERE id = 1
        `,
        [newHash]
      );

      res.json({
        success: true,
        message:
          "Password changed successfully."
      });
    } catch (err) {
      console.error(
        "Password change error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Could not change password.",
        message:
          "Could not change password."
      });
    }
  }
);

/* =========================================================
   PROFILE
========================================================= */

app.get(
  "/api/admin/profile",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT id, username
          FROM admin
          WHERE id = 1
          `
        );

      res.json({
        success: true,
        admin:
          result.rows[0] || null
      });
    } catch (err) {
      console.error(
        "Profile error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Could not load profile.",
        message: "Could not load profile."
      });
    }
  }
);

/* =========================================================
   CLEAN EXPIRED SESSIONS
========================================================= */

setInterval(
  async () => {
    try {
      await pool.query(
        "DELETE FROM user_sessions WHERE expire < NOW()"
      );
    } catch (err) {
      console.error(
        "Session cleanup error:",
        err
      );
    }
  },
  1000 * 60 * 30
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await pool.query(
        "SELECT 1"
      );

      res.json({
        success: true,
        database: "PostgreSQL",
        status: "connected"
      });
    } catch (err) {
      console.error(
        "Health check failed:",
        err
      );

      res.status(500).json({
        success: false,
        database: "PostgreSQL",
        status: "disconnected"
      });
    }
  }
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(
    PUBLIC_DIR
  )
);

/* =========================================================
   ADMIN PAGE
========================================================= */

app.get(
  "/admin",
  (req, res) => {
    const adminFile =
      path.join(
        PUBLIC_DIR,
        "admin.html"
      );

    if (
      fs.existsSync(adminFile)
    ) {
      return res.sendFile(
        adminFile
      );
    }

    res
      .status(404)
      .send(
        "Admin page not found."
      );
  }
);

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.use(
  (req, res) => {
    const indexFile =
      path.join(
        PUBLIC_DIR,
        "index.html"
      );

    if (
      fs.existsSync(indexFile)
    ) {
      return res.sendFile(
        indexFile
      );
    }

    res
      .status(404)
      .send(
        "Page not found."
      );
  }
);

/* =========================================================
   START SERVER
========================================================= */

async function startServer() {
  try {
    console.log(
      "Connecting to PostgreSQL..."
    );

    await pool.query(
      "SELECT 1"
    );

    console.log(
      "PostgreSQL connection successful."
    );

    await initDatabase();

    await initSettings();

    await initAdmin();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          "========================================"
        );

        console.log(
          "HASIYA ACCOUNT STORE"
        );

        console.log(
          "Server running on port:",
          PORT
        );

        console.log(
          "Database: PostgreSQL"
        );

        console.log(
          "Persistent PostgreSQL sessions: ENABLED"
        );

        console.log(
          "Price filters: ENABLED"
        );

        console.log(
          "Admin authentication: ENABLED"
        );

        console.log(
          "========================================"
        );
      }
    );
  } catch (err) {
    console.error(
      "SERVER STARTUP FAILED:"
    );

    console.error(err);

    process.exit(1);
  }
}

startServer();
```
