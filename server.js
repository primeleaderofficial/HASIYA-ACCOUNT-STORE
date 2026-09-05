```js
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const helmet = require("helmet");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.db");
const PUBLIC_DIR = path.join(__dirname, "public");

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================================================
   DATABASE
========================================================= */

let db;

function openDatabase() {
  try {
    db = new Database(DB_FILE);

    db.pragma("foreign_keys = ON");

    console.log("SQLite database opened/created.");
  } catch (err) {
    console.error("Database open failed:", err.message);

    try {
      if (db) {
        db.close();
      }
    } catch {}

    db = null;

    /*
      If an invalid SQLite file exists,
      move it away instead of crashing the server.
    */
    try {
      if (fs.existsSync(DB_FILE)) {
        const backup = path.join(
          DATA_DIR,
          `store.db.invalid-${Date.now()}`
        );

        fs.renameSync(DB_FILE, backup);

        console.error(
          `Invalid database moved to: ${backup}`
        );
      }
    } catch (backupErr) {
      console.error(
        "Could not backup invalid database:",
        backupErr.message
      );
    }

    /*
      Create a completely fresh database.
    */
    db = new Database(DB_FILE);

    db.pragma("foreign_keys = ON");

    console.log("Fresh SQLite database created.");
  }
}

openDatabase();

/* =========================================================
   DATABASE SCHEMA
========================================================= */

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      game TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price >= 0),
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
  `);

  console.log("Database schema initialized.");
}

initSchema();

/* =========================================================
   PASSWORD HASHING
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
    const parts = storedHash.split(":");

    if (parts.length !== 2) {
      return false;
    }

    const salt = parts[0];
    const originalHash = parts[1];

    const hash = crypto
      .scryptSync(password, salt, 64)
      .toString("hex");

    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(originalHash, "hex")
    );
  } catch {
    return false;
  }
}

/* =========================================================
   DEFAULT SETTINGS
========================================================= */

function initSettings() {
  const defaults = {
    whatsapp_number: "",
    store_name: "HASIYA ACCOUNT STORE",
    slogan: "හොරුන්ට අහු වූ කාලේ ඉවරයි.",
    secondary_slogan:
      "100% විශ්වාසවන්ත ලෙස Account වැඩ කරගැනීමට අප සමඟ එකතු වන්න."
  };

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES (?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(defaults)) {
      stmt.run(key, value);
    }
  });

  transaction();
}

initSettings();

/* =========================================================
   DEFAULT ADMIN
========================================================= */

function initAdmin() {
  const existing = db
    .prepare("SELECT id FROM admin WHERE id = 1")
    .get();

  if (!existing) {
    const username = "admin";

    const password = "geenath2009#";

    const passwordHash = hashPassword(password);

    db.prepare(`
      INSERT INTO admin (
        id,
        username,
        password_hash
      )
      VALUES (1, ?, ?)
    `).run(username, passwordHash);

    console.log("Admin account created.");
    console.log("Username: admin");
  }
}

initAdmin();

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

function getSettings() {
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all();

  const settings = {};

  for (const row of rows) {
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

  /*
    Google Drive file URL:
    https://drive.google.com/file/d/FILE_ID/view
  */

  const match = url.match(
    /drive\.google\.com\/file\/d\/([^/]+)/
  );

  if (match) {
    const fileId = match[1];

    return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }

  /*
    Google Drive open URL
  */

  const openMatch = url.match(
    /drive\.google\.com\/open\?id=([^&]+)/
  );

  if (openMatch) {
    return `https://drive.google.com/uc?export=view&id=${openMatch[1]}`;
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

app.get("/api/store", (req, res) => {
  try {
    const settings = getSettings();

    res.json({
      success: true,
      settings
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Could not load store settings."
    });
  }
});

/* =========================================================
   PUBLIC ACCOUNTS API
========================================================= */

app.get("/api/accounts", (req, res) => {
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

    const params = {};

    if (
      minPrice !== null &&
      Number.isFinite(minPrice)
    ) {
      sql += " AND price >= @minPrice";
      params.minPrice = minPrice;
    }

    if (
      maxPrice !== null &&
      Number.isFinite(maxPrice)
    ) {
      sql += " AND price <= @maxPrice";
      params.maxPrice = maxPrice;
    }

    sql += `
      ORDER BY
        featured DESC,
        created_at DESC
    `;

    const rows = db.prepare(sql).all(params);

    res.json({
      success: true,
      accounts: rows.map(normalizeAccount)
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Could not load accounts."
    });
  }
});

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post("/api/admin/login", (req, res) => {
  try {
    const username = cleanString(req.body.username);
    const password = cleanString(req.body.password);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required."
      });
    }

    const admin = db
      .prepare(`
        SELECT *
        FROM admin
        WHERE username = ?
      `)
      .get(username);

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
    console.error(err);

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
  (req, res) => {
    try {
      const total = db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM accounts
        `)
        .get().count;

      const available = db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM accounts
          WHERE status = 'AVAILABLE'
        `)
        .get().count;

      const sold = db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM accounts
          WHERE status = 'SOLD'
        `)
        .get().count;

      const featured = db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM accounts
          WHERE featured = 1
        `)
        .get().count;

      res.json({
        success: true,

        dashboard: {
          total,
          available,
          sold,
          featured
        }
      });
    } catch (err) {
      console.error(err);

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
  (req, res) => {
    try {
      const rows = db
        .prepare(`
          SELECT *
          FROM accounts
          ORDER BY created_at DESC
        `)
        .all();

      res.json({
        success: true,
        accounts: rows.map(normalizeAccount)
      });
    } catch (err) {
      console.error(err);

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
  (req, res) => {
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

      const result = db
        .prepare(`
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
            @title,
            @game,
            @price,
            @image_url,
            @level,
            @fashion,
            @evo_guns,
            @emotes,
            @likes,
            @bind_info,
            @description,
            @featured,
            @status
          )
        `)
        .run({
          title,
          game,
          price,
          image_url: imageUrl,
          level,
          fashion,
          evo_guns: evoGuns,
          emotes,
          likes,
          bind_info: bindInfo,
          description,
          featured,
          status
        });

      const account = db
        .prepare(`
          SELECT *
          FROM accounts
          WHERE id = ?
        `)
        .get(result.lastInsertRowid);

      res.status(201).json({
        success: true,
        message: "Account created.",
        account: normalizeAccount(account)
      });
    } catch (err) {
      console.error(err);

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
  (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid account ID."
        });
      }

      const existing = db
        .prepare(`
          SELECT *
          FROM accounts
          WHERE id = ?
        `)
        .get(id);

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

      db.prepare(`
        UPDATE accounts
        SET
          title = @title,
          game = @game,
          price = @price,
          image_url = @image_url,
          level = @level,
          fashion = @fashion,
          evo_guns = @evo_guns,
          emotes = @emotes,
          likes = @likes,
          bind_info = @bind_info,
          description = @description,
          featured = @featured,
          status = @status,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({
        id,
        title,
        game,
        price,
        image_url: imageUrl,
        level,
        fashion,
        evo_guns: evoGuns,
        emotes,
        likes,
        bind_info: bindInfo,
        description,
        featured,
        status
      });

      const account = db
        .prepare(`
          SELECT *
          FROM accounts
          WHERE id = ?
        `)
        .get(id);

      res.json({
        success: true,
        message: "Account updated.",
        account: normalizeAccount(account)
      });
    } catch (err) {
      console.error(err);

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
  (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid account ID."
        });
      }

      const result = db
        .prepare(`
          DELETE FROM accounts
          WHERE id = ?
        `)
        .run(id);

      if (result.changes === 0) {
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
      console.error(err);

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
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const status =
        req.body.status === "SOLD"
          ? "SOLD"
          : "AVAILABLE";

      const result = db
        .prepare(`
          UPDATE accounts
          SET
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .run(status, id);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          message: "Account not found."
        });
      }

      const account = db
        .prepare(`
          SELECT *
          FROM accounts
          WHERE id = ?
        `)
        .get(id);

      res.json({
        success: true,
        message: "Status updated.",
        account: normalizeAccount(account)
      });
    } catch (err) {
      console.error(err);

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
  (req, res) => {
    try {
      res.json({
        success: true,
        settings: getSettings()
      });
    } catch (err) {
      console.error(err);

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
  (req, res) => {
    try {
      const body = req.body || {};

      const allowedKeys = [
        "whatsapp_number",
        "store_name",
        "slogan",
        "secondary_slogan"
      ];

      const update = db.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key)
        DO UPDATE SET value = excluded.value
      `);

      const transaction = db.transaction(() => {
        for (const key of allowedKeys) {
          if (body[key] !== undefined) {
            update.run(
              key,
              cleanString(body[key])
            );
          }
        }
      });

      transaction();

      res.json({
        success: true,
        message: "Settings updated.",
        settings: getSettings()
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        success: false,
        message: "Could not update settings."
      });
    }
  }
);

/* =========================================================
   ADMIN CHANGE PASSWORD
========================================================= */

app.post(
  "/api/admin/password",
  requireAdmin,
  (req, res) => {
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

      const admin = db
        .prepare(`
          SELECT *
          FROM admin
          WHERE id = 1
        `)
        .get();

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

      db.prepare(`
        UPDATE admin
        SET password_hash = ?
        WHERE id = 1
      `).run(newHash);

      res.json({
        success: true,
        message: "Password changed successfully."
      });
    } catch (err) {
      console.error(err);

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
  (req, res) => {
    try {
      const admin = db
        .prepare(`
          SELECT id, username
          FROM admin
          WHERE id = 1
        `)
        .get();

      res.json({
        success: true,
        admin
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        success: false,
        message: "Could not load profile."
      });
    }
  }
);

/* =========================================================
   STATIC FILES
========================================================= */

app.use(
  express.static(PUBLIC_DIR)
);

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

app.get("*", (req, res) => {
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `HASIYA ACCOUNT STORE running on port ${PORT}`
  );

  console.log(
    `Database: ${DB_FILE}`
  );

  console.log(
    "Admin session/proxy configuration enabled."
  );
});
```
