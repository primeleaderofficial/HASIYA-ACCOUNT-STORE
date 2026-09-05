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
   POSTGRESQL DATABASE
========================================================= */

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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
   DATABASE SCHEMA
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
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
      );
    `);

    await client.query("COMMIT");

    console.log("PostgreSQL database schema initialized.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Database schema initialization failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

/* =========================================================
   PASSWORD HASHING
========================================================= */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return salt + ":" + hash;
}

function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split(":");

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
    "SELECT id FROM admin WHERE id = 1"
  );

  if (result.rows.length === 0) {
    const username = "admin";
    const password = "geenath2009#";

    const passwordHash = hashPassword(password);

    await pool.query(
      `
        INSERT INTO admin (
          id,
          username,
          password_hash
        )
        VALUES (1, $1, $2)
      `,
      [username, passwordHash]
    );

    console.log("Admin account created.");
    console.log("Username: admin");
  } else {
    console.log("Admin account already exists.");
  }
}

/* =========================================================
   SESSION
========================================================= */

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "HASIYA_ACCOUNT_STORE_SESSION_SECRET_CHANGE_THIS",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

/* =========================================================
   HELPERS
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

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  next();
}

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

  const match = url.match(
    /drive\.google\.com\/file\/d\/([^/]+)/
  );

  if (match) {
    return (
      "https://drive.google.com/uc?export=view&id=" +
      match[1]
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
    featured: Boolean(row.featured)
  };
}

/* =========================================================
   PUBLIC STORE API
========================================================= */

app.get("/api/store", async (req, res) => {
  try {
    const settings = await getSettings();

    res.json({
      success: true,
      settings
    });
  } catch (err) {
    console.error("Store API error:", err);

    res.status(500).json({
      success: false,
      message: "Could not load store settings."
    });
  }
});

/* =========================================================
   PUBLIC ACCOUNTS API
========================================================= */

app.get("/api/accounts", async (req, res) => {
  try {
    const minPrice =
      req.query.minPrice !== undefined
        ? Number(req.query.minPrice)
        : null;

    const maxPrice =
      req.query.maxPrice !== undefined
        ? Number(req.query.maxPrice)
        : null;

    let sql = `
      SELECT *
      FROM accounts
      WHERE status = 'AVAILABLE'
    `;

    const params = [];

    if (
      minPrice !== null &&
      Number.isFinite(minPrice)
    ) {
      params.push(minPrice);
      sql += ` AND price >= $${params.length}`;
    }

    if (
      maxPrice !== null &&
      Number.isFinite(maxPrice)
    ) {
      params.push(maxPrice);
      sql += ` AND price <= $${params.length}`;
    }

    sql += `
      ORDER BY
        featured DESC,
        created_at DESC
    `;

    const result = await pool.query(sql, params);

    res.json({
      success: true,
      accounts: result.rows.map(normalizeAccount)
    });
  } catch (err) {
    console.error("Public accounts error:", err);

    res.status(500).json({
      success: false,
      message: "Could not load accounts."
    });
  }
});

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = cleanString(req.body.username);
    const password = cleanString(req.body.password);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required."
      });
    }

    const result = await pool.query(
      `
        SELECT *
        FROM admin
        WHERE username = $1
      `,
      [username]
    );

    const admin = result.rows[0];

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password."
      });
    }

    const valid = verifyPassword(
      password,
      admin.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password."
      });
    }

    req.session.admin = {
      id: admin.id,
      username: admin.username
    };

    res.json({
      success: true,
      message: "Login successful.",
      admin: {
        id: admin.id,
        username: admin.username
      }
    });
  } catch (err) {
    console.error("Login error:", err);

    res.status(500).json({
      success: false,
      message: "Login failed."
    });
  }
});

/* =========================================================
   ADMIN LOGOUT
========================================================= */

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      success: true,
      message: "Logged out."
    });
  });
});

/* =========================================================
   ADMIN SESSION CHECK
========================================================= */

app.get("/api/admin/me", (req, res) => {
  if (!req.session || !req.session.admin) {
    return res.json({
      success: true,
      loggedIn: false
    });
  }

  res.json({
    success: true,
    loggedIn: true,
    admin: req.session.admin
  });
});

/* =========================================================
   ADMIN DASHBOARD
========================================================= */

app.get(
  "/api/admin/dashboard",
  requireAdmin,
  async (req, res) => {
    try {
      const totalResult = await pool.query(`
        SELECT COUNT(*)::integer AS count
        FROM accounts
      `);

      const availableResult = await pool.query(`
        SELECT COUNT(*)::integer AS count
        FROM accounts
        WHERE status = 'AVAILABLE'
      `);

      const soldResult = await pool.query(`
        SELECT COUNT(*)::integer AS count
        FROM accounts
        WHERE status = 'SOLD'
      `);

      const featuredResult = await pool.query(`
        SELECT COUNT(*)::integer AS count
        FROM accounts
        WHERE featured = 1
      `);

      res.json({
        success: true,
        dashboard: {
          total: totalResult.rows[0].count,
          available: availableResult.rows[0].count,
          sold: soldResult.rows[0].count,
          featured: featuredResult.rows[0].count
        }
      });
    } catch (err) {
      console.error("Dashboard error:", err);

      res.status(500).json({
        success: false,
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
      const result = await pool.query(`
        SELECT *
        FROM accounts
        ORDER BY created_at DESC
      `);

      res.json({
        success: true,
        accounts: result.rows.map(normalizeAccount)
      });
    } catch (err) {
      console.error("Admin accounts error:", err);

      res.status(500).json({
        success: false,
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
      const body = req.body || {};

      const title = cleanString(body.title);
      const game = cleanString(body.game);
      const price = cleanNumber(body.price);

      const imageUrl = driveToImageUrl(
        cleanString(
          body.image_url ||
          body.imageUrl ||
          body.image
        )
      );

      const level = cleanString(body.level);
      const fashion = cleanString(body.fashion);

      const evoGuns = cleanString(
        body.evo_guns || body.evoGuns
      );

      const emotes = cleanString(body.emotes);
      const likes = cleanString(body.likes);

      const bindInfo = cleanString(
        body.bind_info || body.bindInfo
      );

      const description = cleanString(
        body.description
      );

      const featured =
        body.featured === true ||
        body.featured === 1 ||
        body.featured === "1"
          ? 1
          : 0;

      const status =
        body.status === "SOLD"
          ? "SOLD"
          : "AVAILABLE";

      if (!title) {
        return res.status(400).json({
          success: false,
          message: "Account title is required."
        });
      }

      if (!game) {
        return res.status(400).json({
          success: false,
          message: "Game is required."
        });
      }

      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          message: "Image URL is required."
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
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13
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

      res.status(201).json({
        success: true,
        message: "Account created.",
        account: normalizeAccount(result.rows[0])
      });
    } catch (err) {
      console.error("Create account error:", err);

      res.status(500).json({
        success: false,
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
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid account ID."
        });
      }

      const existingResult = await pool.query(
        `
          SELECT *
          FROM accounts
          WHERE id = $1
        `,
        [id]
      );

      const existing = existingResult.rows[0];

      if (!existing) {
        return res.status(404).json({
          success: false,
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
              body.evo_guns || body.evoGuns
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
              body.bind_info || body.bindInfo
            )
          : existing.bind_info;

      const description =
        body.description !== undefined
          ? cleanString(body.description)
          : existing.description;

      let featured = existing.featured;

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
          ? body.status === "SOLD"
            ? "SOLD"
            : "AVAILABLE"
          : existing.status;

      if (!title || !game || !imageUrl) {
        return res.status(400).json({
          success: false,
          message:
            "Title, game and image are required."
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
        account: normalizeAccount(result.rows[0])
      });
    } catch (err) {
      console.error("Update account error:", err);

      res.status(500).json({
        success: false,
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
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid account ID."
        });
      }

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
          message: "Account not found."
        });
      }

      res.json({
        success: true,
        message: "Account deleted."
      });
    } catch (err) {
      console.error("Delete account error:", err);

      res.status(500).json({
        success: false,
        message: "Could not delete account."
      });
    }
  }
);

/* =========================================================
   ADMIN CHANGE ACCOUNT STATUS
========================================================= */

app.patch(
  "/api/admin/accounts/:id/status",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid account ID."
        });
      }

      const status =
        req.body.status === "SOLD"
          ? "SOLD"
          : "AVAILABLE";

      const result = await pool.query(
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
          message: "Account not found."
        });
      }

      res.json({
        success: true,
        message: "Status updated.",
        account: normalizeAccount(result.rows[0])
      });
    } catch (err) {
      console.error("Status update error:", err);

      res.status(500).json({
        success: false,
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
        settings: await getSettings()
      });
    } catch (err) {
      console.error("Settings load error:", err);

      res.status(500).json({
        success: false,
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
    const client = await pool.connect();

    try {
      const body = req.body || {};

      const allowedKeys = [
        "whatsapp_number",
        "store_name",
        "slogan",
        "secondary_slogan"
      ];

      await client.query("BEGIN");

      for (const key of allowedKeys) {
        if (body[key] !== undefined) {
          await client.query(
            `
              INSERT INTO settings (key, value)
              VALUES ($1, $2)
              ON CONFLICT (key)
              DO UPDATE SET value = EXCLUDED.value
            `,
            [key, cleanString(body[key])]
          );
        }
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Settings updated.",
        settings: await getSettings()
      });
    } catch (err) {
      await client.query("ROLLBACK");

      console.error("Settings update error:", err);

      res.status(500).json({
        success: false,
        message: "Could not update settings."
      });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   ADMIN CHANGE PASSWORD
========================================================= */

app.post(
  "/api/admin/password",
  requireAdmin,
  async (req, res) => {
    try {
      const currentPassword = cleanString(
        req.body.currentPassword
      );

      const newPassword = cleanString(
        req.body.newPassword
      );

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message:
            "Current and new password are required."
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message:
            "New password must be at least 6 characters."
        });
      }

      const result = await pool.query(
        `
          SELECT *
          FROM admin
          WHERE id = 1
        `
      );

      const admin = result.rows[0];

      if (!admin) {
        return res.status(500).json({
          success: false,
          message: "Admin account not found."
        });
      }

      const valid = verifyPassword(
        currentPassword,
        admin.password_hash
      );

      if (!valid) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect."
        });
      }

      const newHash = hashPassword(newPassword);

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
        message: "Password changed successfully."
      });
    } catch (err) {
      console.error("Password change error:", err);

      res.status(500).json({
        success: false,
        message: "Could not change password."
      });
    }
  }
);

/* =========================================================
   ADMIN PROFILE
========================================================= */

app.get(
  "/api/admin/profile",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, username
        FROM admin
        WHERE id = 1
      `);

      res.json({
        success: true,
        admin: result.rows[0] || null
      });
    } catch (err) {
      console.error("Profile error:", err);

      res.status(500).json({
        success: false,
        message: "Could not load profile."
      });
    }
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      database: "PostgreSQL",
      status: "connected"
    });
  } catch (err) {
    console.error("Health check failed:", err);

    res.status(500).json({
      success: false,
      database: "PostgreSQL",
      status: "disconnected"
    });
  }
});

/* =========================================================
   STATIC FILES
========================================================= */

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   ADMIN PAGE
========================================================= */

app.get("/admin", (req, res) => {
  const adminFile = path.join(
    PUBLIC_DIR,
    "admin.html"
  );

  if (fs.existsSync(adminFile)) {
    return res.sendFile(adminFile);
  }

  res.status(404).send("Admin page not found.");
});

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.use((req, res) => {
  const indexFile = path.join(
    PUBLIC_DIR,
    "index.html"
  );

  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }

  res.status(404).send("Page not found.");
});

/* =========================================================
   START SERVER
========================================================= */

async function startServer() {
  try {
    console.log("Connecting to PostgreSQL...");

    await pool.query("SELECT 1");

    console.log("PostgreSQL connection successful.");

    await initDatabase();
    await initSettings();
    await initAdmin();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        "HASIYA ACCOUNT STORE running on port " + PORT
      );

      console.log("Database: PostgreSQL");

      console.log(
        "Admin session/proxy configuration enabled."
      );
    });
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
