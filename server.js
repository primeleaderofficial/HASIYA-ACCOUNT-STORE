const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const helmet = require("helmet");
const crypto = require("crypto");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

/*
========================================================
POSTGRESQL
========================================================
*/

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function sqlRun(sql, params = []) {
  return pool.query(sql, params);
}

async function sqlAll(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function sqlGet(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

/*
========================================================
DATABASE SCHEMA
========================================================
*/

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,

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

      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  console.log("PostgreSQL database initialized.");
}

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

    const actualBuffer = Buffer.from(actual, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

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

async function getSetting(key) {
  const row = await sqlGet(
    "SELECT value FROM settings WHERE key=$1",
    [key]
  );

  return row ? row.value : "";
}

async function setSetting(key, value) {
  await sqlRun(
    `
      INSERT INTO settings(key,value)
      VALUES($1,$2)

      ON CONFLICT(key)
      DO UPDATE SET value=EXCLUDED.value
    `,
    [
      key,
      String(value ?? "")
    ]
  );
}

/*
========================================================
GOOGLE DRIVE IMAGE URL
========================================================
*/

function driveToImageUrl(input) {
  const url = String(input || "").trim();

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

  if (/^https?:\/\//i.test(url)) {
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

  if (p >= 1000 && p <= 10000) return "1";
  if (p > 10000 && p <= 20000) return "2";
  if (p > 20000 && p <= 30000) return "3";
  if (p > 30000 && p <= 40000) return "4";
  if (p > 40000 && p <= 50000) return "5";
  if (p > 50000 && p <= 60000) return "6";
  if (p > 60000 && p <= 70000) return "7";
  if (p > 70000 && p <= 80000) return "8";
  if (p > 80000 && p <= 90000) return "9";
  if (p > 90000 && p <= 100000) return "10";
  if (p > 100000 && p <= 200000) return "11";
  if (p > 200000 && p <= 300000) return "12";
  if (p > 300000 && p <= 400000) return "13";
  if (p > 400000 && p <= 500000) return "14";
  if (p > 500000 && p <= 600000) return "15";
  if (p > 600000 && p <= 700000) return "16";
  if (p > 700000 && p <= 800000) return "17";
  if (p > 800000 && p <= 900000) return "18";
  if (p > 900000 && p <= 1000000) return "19";

  return "all";
}

/*
========================================================
VALIDATE ACCOUNT
========================================================
*/

function validateAccount(body) {
  const title =
    String(body.title || "").trim();

  const game =
    String(body.game || "").trim();

  const price =
    Number(body.price);

  const image_url =
    driveToImageUrl(body.image_url);

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
      String(body.level || "").trim(),

    fashion:
      String(body.fashion || "").trim(),

    evo_guns:
      String(body.evo_guns || "").trim(),

    emotes:
      String(body.emotes || "").trim(),

    likes:
      String(body.likes || "").trim(),

    bind_info:
      String(body.bind_info || "").trim(),

    description:
      String(body.description || "").trim(),

    featured:
      body.featured ? 1 : 0,

    status:
      body.status === "SOLD"
        ? "SOLD"
        : "AVAILABLE"
  };
}

/*
========================================================
STARTUP
========================================================
*/

async function startServer() {
  try {
    await initSchema();

    /*
    ====================================================
    DEFAULT SETTINGS
    ====================================================
    */

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
      await sqlRun(
        `
          INSERT INTO settings(key,value)
          VALUES($1,$2)

          ON CONFLICT(key)
          DO NOTHING
        `,
        [
          key,
          value
        ]
      );
    }

    /*
    ====================================================
    ADMIN
    ====================================================
    */

    const adminUsername = "admin";
    const adminPassword = "geenath2009#";

    if (adminPassword.length < 10) {
      console.error(
        "Admin password must be at least 10 characters."
      );

      process.exit(1);
    }

    const existingAdmin =
      await sqlGet(
        "SELECT id FROM admin WHERE id=1"
      );

    if (!existingAdmin) {
      await sqlRun(
        `
          INSERT INTO admin(
            id,
            username,
            password_hash
          )

          VALUES(
            1,
            $1,
            $2
          )
        `,
        [
          adminUsername,
          hashPassword(adminPassword)
        ]
      );

      console.log("Admin account created.");
    } else {
      console.log("Admin account already exists.");
    }

    /*
    ====================================================
    MIDDLEWARE
    ====================================================
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

    app.use(
      session({
        secret:
          process.env.SESSION_SECRET ||
          "HASIYA_ACCOUNT_STORE_CHANGE_THIS_SECRET",

        resave: false,

        saveUninitialized: false,

        cookie: {
          httpOnly: true,

          sameSite: "lax",

          secure:
            process.env.NODE_ENV === "production",

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
    ====================================================
    AUTH
    ====================================================
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
    ====================================================
    STORE API
    ====================================================
    */

    app.get(
      "/api/store",
      async (req, res, next) => {
        try {
          const rows =
            await sqlAll(
              "SELECT key,value FROM settings"
            );

          const settings =
            Object.fromEntries(
              rows.map(row => [
                row.key,
                row.value
              ])
            );

          res.json({
            settings: {
              store_name:
                settings.store_name || "",

              slogan:
                settings.slogan || "",

              secondary_slogan:
                settings.secondary_slogan || "",

              whatsapp_number:
                settings.whatsapp_number || ""
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
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    PUBLIC ACCOUNTS
    ====================================================
    */

    app.get(
      "/api/accounts",
      async (req, res, next) => {
        try {
          const sold =
            req.query.sold === "1";

          const range =
            String(
              req.query.range || "all"
            );

          let sql =
            "SELECT * FROM accounts WHERE status=$1";

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
              ` AND price >= $2 AND price <= $3`;

            params.push(
              ranges[range][0],
              ranges[range][1]
            );
          }

          sql += sold
            ? " ORDER BY updated_at DESC, id DESC"
            : " ORDER BY featured DESC, price ASC, id DESC";

          const rows =
            await sqlAll(
              sql,
              params
            );

          res.json(rows);
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    ADMIN LOGIN
    ====================================================
    */

    app.post(
      "/api/admin/login",
      async (req, res, next) => {
        try {
          const {
            username,
            password
          } = req.body || {};

          const admin =
            await sqlGet(
              "SELECT * FROM admin WHERE id=1"
            );

          if (
            !admin ||
            username !== admin.username ||
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
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    ADMIN LOGOUT
    ====================================================
    */

    app.post(
      "/api/admin/logout",
      auth,
      (req, res) => {
        req.session.destroy(
          err => {
            if (err) {
              console.error(
                "Session destroy error:",
                err
              );

              return res
                .status(500)
                .json({
                  error:
                    "Logout failed"
                });
            }

            res.json({
              ok: true
            });
          }
        );
      }
    );

    /*
    ====================================================
    ADMIN SESSION
    ====================================================
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
    ====================================================
    ADMIN DASHBOARD
    ====================================================
    */

    app.get(
      "/api/admin/dashboard",
      auth,
      async (req, res, next) => {
        try {
          const total =
            (await sqlGet(
              "SELECT COUNT(*) AS c FROM accounts"
            )).c;

          const available =
            (await sqlGet(
              `
                SELECT COUNT(*) AS c
                FROM accounts
                WHERE status='AVAILABLE'
              `
            )).c;

          const sold =
            (await sqlGet(
              `
                SELECT COUNT(*) AS c
                FROM accounts
                WHERE status='SOLD'
              `
            )).c;

          const featured =
            (await sqlGet(
              `
                SELECT COUNT(*) AS c
                FROM accounts
                WHERE featured=1
              `
            )).c;

          const value =
            (await sqlGet(
              `
                SELECT COALESCE(
                  SUM(price),
                  0
                ) AS v

                FROM accounts

                WHERE status='AVAILABLE'
              `
            )).v;

          res.json({
            total: Number(total),

            available: Number(available),

            sold: Number(sold),

            featured: Number(featured),

            totalListedValue:
              Number(value)
          });
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    ADMIN ACCOUNTS
    ====================================================
    */

    app.get(
      "/api/admin/accounts",
      auth,
      async (req, res, next) => {
        try {
          const rows =
            await sqlAll(
              `
                SELECT *

                FROM accounts

                ORDER BY
                  updated_at DESC,
                  id DESC
              `
            );

          res.json(rows);
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    ADD ACCOUNT
    ====================================================
    */

    app.post(
      "/api/admin/accounts",
      auth,
      async (req, res, next) => {
        try {
          const a =
            validateAccount(
              req.body
            );

          const result =
            await sqlRun(
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
                  $13,
                  CURRENT_TIMESTAMP
                )

                RETURNING id
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
            ok: true,

            id:
              Number(
                result.rows[0].id
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
    ====================================================
    EDIT ACCOUNT
    ====================================================
    */

    app.put(
      "/api/admin/accounts/:id",
      auth,
      async (req, res, next) => {
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
            await sqlRun(
              `
                UPDATE accounts

                SET
                  title=$1,
                  game=$2,
                  price=$3,
                  image_url=$4,
                  level=$5,
                  fashion=$6,
                  evo_guns=$7,
                  emotes=$8,
                  likes=$9,
                  bind_info=$10,
                  description=$11,
                  featured=$12,
                  status=$13,
                  updated_at=CURRENT_TIMESTAMP

                WHERE id=$14
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

          if (!result.rowCount) {
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
    ====================================================
    DELETE ACCOUNT
    ====================================================
    */

    app.delete(
      "/api/admin/accounts/:id",
      auth,
      async (req, res, next) => {
        try {
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
            await sqlRun(
              "DELETE FROM accounts WHERE id=$1",
              [id]
            );

          res.json({
            ok:
              !!result.rowCount
          });
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    SOLD / AVAILABLE
    ====================================================
    */

    app.patch(
      "/api/admin/accounts/:id/status",
      auth,
      async (req, res, next) => {
        try {
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

          const status =
            req.body.status === "SOLD"
              ? "SOLD"
              : "AVAILABLE";

          const result =
            await sqlRun(
              `
                UPDATE accounts

                SET
                  status=$1,
                  updated_at=CURRENT_TIMESTAMP

                WHERE id=$2
              `,
              [
                status,
                id
              ]
            );

          res.json({
            ok:
              !!result.rowCount
          });
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    ADMIN SETTINGS
    ====================================================
    */

    app.put(
      "/api/admin/settings",
      auth,
      async (req, res, next) => {
        try {
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
              await setSetting(
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
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    GET ADMIN SETTINGS
    ====================================================
    */

    app.get(
      "/api/admin/settings",
      auth,
      async (req, res, next) => {
        try {
          const rows =
            await sqlAll(
              "SELECT key,value FROM settings"
            );

          const settings =
            Object.fromEntries(
              rows.map(row => [
                row.key,
                row.value
              ])
            );

          res.json({
            whatsapp_number:
              settings.whatsapp_number || "",

            store_name:
              settings.store_name || "",

            slogan:
              settings.slogan || "",

            secondary_slogan:
              settings.secondary_slogan || ""
          });
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    CHANGE PASSWORD
    ====================================================
    */

    app.post(
      "/api/admin/password",
      auth,
      async (req, res, next) => {
        try {
          const current =
            String(
              req.body.currentPassword ||
              ""
            );

          const nextPassword =
            String(
              req.body.newPassword ||
              ""
            );

          const admin =
            await sqlGet(
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
            nextPassword.length < 10
          ) {
            return res
              .status(400)
              .json({
                error:
                  "New password must be at least 10 characters"
              });
          }

          await sqlRun(
            `
              UPDATE admin

              SET password_hash=$1

              WHERE id=1
            `,
            [
              hashPassword(
                nextPassword
              )
            ]
          );

          res.json({
            ok: true
          });
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    ADMIN PROFILE
    ====================================================
    */

    app.get(
      "/api/admin/profile",
      auth,
      async (req, res, next) => {
        try {
          const admin =
            await sqlGet(
              `
                SELECT
                  id,
                  username

                FROM admin

                WHERE id=1
              `
            );

          if (!admin) {
            return res
              .status(404)
              .json({
                error:
                  "Admin not found"
              });
          }

          res.json({
            id:
              Number(admin.id),

            username:
              admin.username
          });
        } catch (err) {
          next(err);
        }
      }
    );

    /*
    ====================================================
    ADMIN PAGE
    ====================================================
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
    ====================================================
    EXPRESS FALLBACK
    ====================================================
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
    ====================================================
    404 API
    ====================================================
    */

    app.use(
      (req, res, next) => {
        if (
          req.path.startsWith("/api/")
        ) {
          return res
            .status(404)
            .json({
              error:
                "API endpoint not found"
            });
        }

        next();
      }
    );

    /*
    ====================================================
    ERROR HANDLER
    ====================================================
    */

    app.use(
      (
        err,
        req,
        res,
        next
      ) => {
        console.error(
          "Server error:",
          err
        );

        if (res.headersSent) {
          return next(err);
        }

        res
          .status(500)
          .json({
            error:
              "Internal server error"
          });
      }
    );

    /*
    ====================================================
    START SERVER
    ====================================================
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
            "Database: PostgreSQL"
          );
        }
      );

    /*
    ====================================================
    GRACEFUL SHUTDOWN
    ====================================================
    */

    async function shutdown(signal) {
      console.log(
        `${signal} received. Shutting down...`
      );

      server.close(
        async () => {
          try {
            await pool.end();

            console.log(
              "PostgreSQL connection closed."
            );
          } catch (err) {
            console.error(
              "Database close error:",
              err.message
            );
          }

          process.exit(0);
        }
      );
    }

    process.on(
      "SIGINT",
      () => shutdown("SIGINT")
    );

    process.on(
      "SIGTERM",
      () => shutdown("SIGTERM")
    );

  } catch (err) {
    console.error(
      "DATABASE STARTUP ERROR:",
      err
    );

    process.exit(1);
  }
}

startServer();
