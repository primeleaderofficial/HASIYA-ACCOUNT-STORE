```javascript
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const helmet = require("helmet");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

/*
========================================================
DATABASE
========================================================
*/

let db;

function openDatabase() {
  try {
    db = new Database(DB_FILE);

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    console.log("SQLite database opened.");
  } catch (err) {
    console.error("Database open failed:", err.message);

    const backup = path.join(
      DATA_DIR,
      `store.db.invalid-${Date.now()}`
    );

    try {
      if (fs.existsSync(DB_FILE)) {
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

    db = new Database(DB_FILE);

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    console.log("Created a new SQLite database.");
  }
}

openDatabase();

/*
========================================================
SQL HELPERS
========================================================
*/

function sqlRun(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function sqlAll(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function sqlGet(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/*
better-sqlite3 writes directly to the database.
No export/save operation is required.
*/

function saveDb() {
  // Intentionally empty.
}

/*
========================================================
DATABASE SCHEMA
========================================================
*/

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      title TEXT NOT NULL,

      game TEXT NOT NULL,

      price INTEGER NOT NULL
        CHECK(price >= 0),

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
        CHECK(status IN ('AVAILABLE','SOLD')),

      created_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TEXT NOT NULL
        DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY
        CHECK(id = 1),

      username TEXT NOT NULL UNIQUE,

      password_hash TEXT NOT NULL
    );
  `);
}

initSchema();

/*
========================================================
PASSWORD FUNCTIONS
========================================================
*/

function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString("hex")
) {
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split("$");

    if (parts.length !== 3) {
      return false;
    }

    const [, salt, expected] = parts;

    if (!salt || !expected) {
      return false;
    }

    const actual = crypto
      .scryptSync(password, salt, 64)
      .toString("hex");

    const actualBuffer = Buffer.from(
      actual,
      "hex"
    );

    const expectedBuffer = Buffer.from(
      expected,
      "hex"
    );

    if (
      actualBuffer.length !==
      expectedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer
    );
  } catch {
    return false;
  }
}

/*
========================================================
SETTINGS
========================================================
*/

function getSetting(key) {
  const row = sqlGet(
    "SELECT value FROM settings WHERE key=?",
    [key]
  );

  return row ? row.value : "";
}

function setSetting(key, value) {
  sqlRun(
    `
      INSERT INTO settings(key,value)
      VALUES(?,?)

      ON CONFLICT(key)
      DO UPDATE SET value=excluded.value
    `,
    [
      key,
      String(value ?? "")
    ]
  );
}

const defaultSettings = {
  whatsapp_number: "",

  store_name:
    "HASIYA ACCOUNT STORE",

  slogan:
    "හොරුන්ට අහු වූ කාලේ ඉවරයි.",

  secondary_slogan:
    "100% විශ්වාසවන්ත ලෙස Account වැඩ කරගැනීමට අප සමඟ එකතු වන්න."
};

for (
  const [key, value]
  of Object.entries(defaultSettings)
) {
  sqlRun(
    `
      INSERT OR IGNORE INTO settings(key,value)
      VALUES(?,?)
    `,
    [key, value]
  );
}

/*
========================================================
ADMIN ACCOUNT
========================================================

Default admin:

Username: admin
Password: geenath2009#

NOTE:
This intentionally keeps the requested credentials.
========================================================
*/

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "geenath2009#";

if (ADMIN_PASSWORD.length < 10) {
  console.error(
    "Admin password must be at least 10 characters."
  );

  process.exit(1);
}

const existingAdmin = sqlGet(
  "SELECT id FROM admin WHERE id=1"
);

if (!existingAdmin) {
  sqlRun(
    `
      INSERT INTO admin(
        id,
        username,
        password_hash
      )
      VALUES(1, ?, ?)
    `,
    [
      ADMIN_USERNAME,
      hashPassword(ADMIN_PASSWORD)
    ]
  );

  console.log(
    "Admin account created."
  );
} else {
  sqlRun(
    `
      UPDATE admin
      SET
        username=?,
        password_hash=?
      WHERE id=1
    `,
    [
      ADMIN_USERNAME,
      hashPassword(ADMIN_PASSWORD)
    ]
  );

  console.log(
    "Admin credentials synchronized."
  );
}

/*
========================================================
GOOGLE DRIVE IMAGE URL
========================================================
*/

function driveToImageUrl(input) {
  const url =
    String(input || "").trim();

  if (!url) {
    return "";
  }

  const patterns = [
    /\/file\/d\/([^/]+)/,
    /[?&]id=([^&]+)/,
    /\/open\?id=([^&]+)/
  ];

  for (const re of patterns) {
    const match = url.match(re);

    if (match) {
      return (
        "https://drive.google.com/uc" +
        "?export=view&id=" +
        encodeURIComponent(match[1])
      );
    }
  }

  if (
    /^https?:\/\//i.test(url)
  ) {
    return url;
  }

  return "";
}

/*
========================================================
PRICE RANGE
========================================================
*/

function priceRange(price) {
  const p = Number(price);

  if (p >= 1000 && p <= 10000)
    return "1";

  if (p > 10000 && p <= 20000)
    return "2";

  if (p > 20000 && p <= 30000)
    return "3";

  if (p > 30000 && p <= 40000)
    return "4";

  if (p > 40000 && p <= 50000)
    return "5";

  if (p > 50000 && p <= 60000)
    return "6";

  if (p > 60000 && p <= 70000)
    return "7";

  if (p > 70000 && p <= 80000)
    return "8";

  if (p > 80000 && p <= 90000)
    return "9";

  if (p > 90000 && p <= 100000)
    return "10";

  if (p > 100000 && p <= 200000)
    return "11";

  if (p > 200000 && p <= 300000)
    return "12";

  if (p > 300000 && p <= 400000)
    return "13";

  if (p > 400000 && p <= 500000)
    return "14";

  if (p > 500000 && p <= 600000)
    return "15";

  if (p > 600000 && p <= 700000)
    return "16";

  if (p > 700000 && p <= 800000)
    return "17";

  if (p > 800000 && p <= 900000)
    return "18";

  if (p > 900000 && p <= 1000000)
    return "19";

  return "all";
}

/*
========================================================
MIDDLEWARE
========================================================
*/

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(
  express.urlencoded({
    extended: false
  })
);

const sessionSecret =
  process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString("hex");

app.use(
  session({
    secret: sessionSecret,

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,

      sameSite: "lax",

      secure:
        process.env.NODE_ENV ===
        "production",

      maxAge:
        8 * 60 * 60 * 1000
    }
  })
);

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

/*
========================================================
AUTH
========================================================
*/

function auth(req, res, next) {
  if (
    req.session &&
    req.session.admin
  ) {
    return next();
  }

  return res
    .status(401)
    .json({
      error: "Unauthorized"
    });
}

/*
========================================================
STORE API
========================================================
*/

app.get(
  "/api/store",
  (req, res) => {
    const settings =
      Object.fromEntries(
        sqlAll(
          "SELECT key,value FROM settings"
        ).map(row => [
          row.key,
          row.value
        ])
      );

    res.json({
      settings: {
        store_name:
          settings.store_name,

        slogan:
          settings.slogan,

        secondary_slogan:
          settings.secondary_slogan,

        whatsapp_number:
          settings.whatsapp_number
      },

      priceRanges: [
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
      ]
    });
  }
);

/*
========================================================
PUBLIC ACCOUNTS
========================================================
*/

app.get(
  "/api/accounts",
  (req, res) => {
    const sold =
      req.query.sold === "1";

    const range =
      String(
        req.query.range || "all"
      );

    let sql =
      "SELECT * FROM accounts WHERE status=?";

    const params = [
      sold
        ? "SOLD"
        : "AVAILABLE"
    ];

    const ranges = {
      1: [1000, 10000],
      2: [10000, 20000],
      3: [20000, 30000],
      4: [30000, 40000],
      5: [40000, 50000],
      6: [50000, 60000],
      7: [60000, 70000],
      8: [70000, 80000],
      9: [80000, 90000],
      10: [90000, 100000],
      11: [100000, 200000],
      12: [200000, 300000],
      13: [300000, 400000],
      14: [400000, 500000],
      15: [500000, 600000],
      16: [600000, 700000],
      17: [700000, 800000],
      18: [800000, 900000],
      19: [900000, 1000000]
    };

    if (
      !sold &&
      range !== "all" &&
      ranges[range]
    ) {
      sql +=
        " AND price >= ? AND price <= ?";

      params.push(
        ranges[range][0],
        ranges[range][1]
      );
    }

    sql += sold
      ? " ORDER BY updated_at DESC, id DESC"
      : " ORDER BY featured DESC, price ASC, id DESC";

    res.json(
      sqlAll(
        sql,
        params
      )
    );
  }
);

/*
========================================================
ADMIN LOGIN
========================================================
*/

app.post(
  "/api/admin/login",
  (req, res) => {
    const {
      username,
      password
    } = req.body || {};

    const admin =
      sqlGet(
        "SELECT * FROM admin WHERE id=1"
      );

    if (
      !admin ||
      String(username || "") !==
        admin.username ||
      !verifyPassword(
        String(password || ""),
        admin.password_hash
      )
    ) {
      return res
        .status(401)
        .json({
          error:
            "Invalid credentials"
        });
    }

    req.session.admin = true;

    res.json({
      ok: true
    });
  }
);

/*
========================================================
ADMIN LOGOUT
========================================================
*/

app.post(
  "/api/admin/logout",
  auth,
  (req, res) => {
    req.session.destroy(() => {
      res.json({
        ok: true
      });
    });
  }
);

/*
========================================================
ADMIN SESSION
========================================================
*/

app.get(
  "/api/admin/me",
  (req, res) => {
    res.json({
      authenticated:
        !!(
          req.session &&
          req.session.admin
        )
    });
  }
);

/*
========================================================
ADMIN DASHBOARD
========================================================
*/

app.get(
  "/api/admin/dashboard",
  auth,
  (req, res) => {
    const total =
      sqlGet(
        "SELECT COUNT(*) c FROM accounts"
      ).c;

    const available =
      sqlGet(
        `
        SELECT COUNT(*) c
        FROM accounts
        WHERE status='AVAILABLE'
        `
      ).c;

    const sold =
      sqlGet(
        `
        SELECT COUNT(*) c
        FROM accounts
        WHERE status='SOLD'
        `
      ).c;

    const featured =
      sqlGet(
        `
        SELECT COUNT(*) c
        FROM accounts
        WHERE featured=1
        `
      ).c;

    const value =
      sqlGet(
        `
        SELECT COALESCE(SUM(price),0) v
        FROM accounts
        WHERE status='AVAILABLE'
        `
      ).v;

    res.json({
      total,

      available,

      sold,

      featured,

      totalListedValue:
        value
    });
  }
);

/*
========================================================
ADMIN ACCOUNTS
========================================================
*/

app.get(
  "/api/admin/accounts",
  auth,
  (req, res) => {
    res.json(
      sqlAll(
        `
        SELECT *
        FROM accounts
        ORDER BY updated_at DESC, id DESC
        `
      )
    );
  }
);

/*
========================================================
VALIDATE ACCOUNT
========================================================
*/

function validateAccount(body) {
  const title =
    String(
      body.title || ""
    ).trim();

  const game =
    String(
      body.game || ""
    ).trim();

  const price =
    Number(body.price);

  const image_url =
    driveToImageUrl(
      body.image_url
    );

  if (
    !title ||
    !game ||
    !Number.isFinite(price) ||
    price < 0 ||
    !image_url
  ) {
    throw new Error(
      "Title, game, valid price and Google Drive/image URL are required."
    );
  }

  return {
    title,

    game,

    price:
      Math.round(price),

    image_url,

    level:
      String(
        body.level || ""
      ),

    fashion:
      String(
        body.fashion || ""
      ),

    evo_guns:
      String(
        body.evo_guns || ""
      ),

    emotes:
      String(
        body.emotes || ""
      ),

    likes:
      String(
        body.likes || ""
      ),

    bind_info:
      String(
        body.bind_info || ""
      ),

    description:
      String(
        body.description || ""
      ),

    featured:
      body.featured
        ? 1
        : 0,

    status:
      body.status === "SOLD"
        ? "SOLD"
        : "AVAILABLE"
  };
}

/*
========================================================
ADD ACCOUNT
========================================================
*/

app.post(
  "/api/admin/accounts",
  auth,
  (req, res) => {
    try {
      const a =
        validateAccount(
          req.body
        );

      const result =
        db.prepare(
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
            status,
            updated_at
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
            @status,
            CURRENT_TIMESTAMP
          )
          `
        )
        .run({
          title: a.title,

          game: a.game,

          price: a.price,

          image_url:
            a.image_url,

          level: a.level,

          fashion:
            a.fashion,

          evo_guns:
            a.evo_guns,

          emotes:
            a.emotes,

          likes:
            a.likes,

          bind_info:
            a.bind_info,

          description:
            a.description,

          featured:
            a.featured,

          status:
            a.status
        });

      res.json({
        ok: true,

        id:
          Number(
            result.lastInsertRowid
          )
      });
    } catch (e) {
      console.error(e);

      res
        .status(400)
        .json({
          error:
            e.message
        });
    }
  }
);

/*
========================================================
EDIT ACCOUNT
========================================================
*/

app.put(
  "/api/admin/accounts/:id",
  auth,
  (req, res) => {
    try {
      const a =
        validateAccount(
          req.body
        );

      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid account ID"
          });
      }

      const result =
        db.prepare(
          `
          UPDATE accounts

          SET
            title=@title,
            game=@game,
            price=@price,
            image_url=@image_url,
            level=@level,
            fashion=@fashion,
            evo_guns=@evo_guns,
            emotes=@emotes,
            likes=@likes,
            bind_info=@bind_info,
            description=@description,
            featured=@featured,
            status=@status,
            updated_at=CURRENT_TIMESTAMP

          WHERE id=@id
          `
        )
        .run({
          title: a.title,

          game: a.game,

          price: a.price,

          image_url:
            a.image_url,

          level:
            a.level,

          fashion:
            a.fashion,

          evo_guns:
            a.evo_guns,

          emotes:
            a.emotes,

          likes:
            a.likes,

          bind_info:
            a.bind_info,

          description:
            a.description,

          featured:
            a.featured,

          status:
            a.status,

          id
        });

      if (!result.changes) {
        return res
          .status(404)
          .json({
            error:
              "Account not found"
          });
      }

      res.json({
        ok: true
      });
    } catch (e) {
      console.error(e);

      res
        .status(400)
        .json({
          error:
            e.message
        });
    }
  }
);

/*
========================================================
DELETE ACCOUNT
========================================================
*/

app.delete(
  "/api/admin/accounts/:id",
  auth,
  (req, res) => {
    const id =
      Number(
        req.params.id
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid account ID"
        });
    }

    const result =
      sqlRun(
        `
        DELETE FROM accounts
        WHERE id=?
        `,
        [id]
      );

    res.json({
      ok:
        !!result.changes
    });
  }
);

/*
========================================================
SOLD / AVAILABLE
========================================================
*/

app.patch(
  "/api/admin/accounts/:id/status",
  auth,
  (req, res) => {
    const status =
      req.body.status === "SOLD"
        ? "SOLD"
        : "AVAILABLE";

    const id =
      Number(
        req.params.id
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid account ID"
        });
    }

    const result =
      sqlRun(
        `
        UPDATE accounts

        SET
          status=?,
          updated_at=CURRENT_TIMESTAMP

        WHERE id=?
        `,
        [
          status,
          id
        ]
      );

    res.json({
      ok:
        !!result.changes
    });
  }
);

/*
========================================================
ADMIN SETTINGS
========================================================
*/

app.put(
  "/api/admin/settings",
  auth,
  (req, res) => {
    const allowedKeys = [
      "whatsapp_number",
      "store_name",
      "slogan",
      "secondary_slogan"
    ];

    for (
      const key of allowedKeys
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          key
        )
      ) {
        setSetting(
          key,
          String(
            req.body[key] ?? ""
          ).trim()
        );
      }
    }

    res.json({
      ok: true
    });
  }
);

/*
========================================================
CHANGE PASSWORD
========================================================
*/

app.post(
  "/api/admin/password",
  auth,
  (req, res) => {
    const current =
      String(
        req.body.currentPassword ||
          ""
      );

    const next =
      String(
        req.body.newPassword ||
          ""
      );

    const admin =
      sqlGet(
        "SELECT * FROM admin WHERE id=1"
      );

    if (
      !admin ||
      !verifyPassword(
        current,
        admin.password_hash
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Current password is incorrect"
        });
    }

    if (
      next.length < 10
    ) {
      return res
        .status(400)
        .json({
          error:
            "New password must be at least 10 characters"
        });
    }

    sqlRun(
      `
      UPDATE admin

      SET password_hash=?

      WHERE id=1
      `,
      [
        hashPassword(next)
      ]
    );

    res.json({
      ok: true
    });
  }
);

/*
========================================================
FRONTEND ROUTES
========================================================
*/

app.get(
  "/admin",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

/*
========================================================
FRONTEND FALLBACK
========================================================
*/

app.use(
  (req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path.startsWith("/api/")
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/*
========================================================
404 HANDLER
========================================================
*/

app.use(
  (req, res) => {
    res
      .status(404)
      .json({
        error:
          "Not found"
      });
  }
);

/*
========================================================
ERROR HANDLER
========================================================
*/

app.use(
  (err, req, res, next) => {
    console.error(
      "Server error:",
      err
    );

    res
      .status(500)
      .json({
        error:
          "Internal server error"
      });
  }
);

/*
========================================================
START SERVER
========================================================
*/

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `HASIYA ACCOUNT STORE running on port ${PORT}`
      );

      console.log(
        `Database: ${DB_FILE}`
      );
    }
  );

/*
========================================================
GRACEFUL SHUTDOWN
========================================================
*/

function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(() => {
    try {
      db.close();

      console.log(
        "Database closed."
      );
    } catch (err) {
      console.error(
        "Database close error:",
        err.message
      );
    }

    process.exit(0);
  });
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);
```
