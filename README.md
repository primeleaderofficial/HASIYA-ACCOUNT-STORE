# HASIYA ACCOUNT STORE V1

A production-oriented Node.js + Express + SQLite gaming account marketplace.

## Requirements
- Node.js 18+ (Node.js 20/22/24 supported)
- npm

## Install / run
```bash
npm install
npm start
```

Open:
- Store: http://localhost:3000/
- Admin: http://localhost:3000/admin

On first start, the app creates the SQLite database and a random admin password in `data/first-run-admin.txt`.
**Change it immediately** from Admin → Settings.

## Security
- Admin authentication is server-side with an HTTP-only session cookie.
- Passwords are stored as scrypt hashes, not plaintext in JavaScript.
- Admin API routes require authentication.
- Helmet security headers are enabled.
- Change the default generated password before production use.
- Put the site behind HTTPS in production and set `TRUST_PROXY=1` when appropriate.

Optional environment:
- `PORT=3000`
- `SESSION_SECRET=<long-random-secret>`
- `TRUST_PROXY=1`

## Google Drive images
Paste a normal Drive sharing URL. The server extracts the file ID and generates:
`https://drive.google.com/uc?export=view&id=FILE_ID`

The Drive file must be accessible to "Anyone with the link". Google may restrict hotlinking for some files; if that happens, use a direct/public image host.

## Legal / platform rule
Only list accounts that the store is legitimately authorized to sell. Game-account trading may be restricted by individual publishers' Terms of Service, so check applicable rules before listing an account.

## Production deployment
1. Install Node.js 20+.
2. Copy the project to the server.
3. Run `npm install`.
4. Set a strong `SESSION_SECRET`.
5. Run `npm start`.
6. Put a reverse proxy such as IIS/Nginx/Caddy in front of Node and enable HTTPS.
7. Back up `data/store.db` regularly.
8. Change the generated admin password immediately.

## Project structure
- `server.js` - Express server, API, SQLite (sql.js/WASM) database, authentication
- `public/index.html` - public store
- `public/admin.html` - admin dashboard
- `public/styles.css` - shared premium dark-blue design
- `public/app.js` - public store logic
- `public/admin.js` - admin logic
- `data/` - SQLite DB and first-run credential file (created automatically)

## Windows / Node 24 note
This V1.0.1 build uses `sql.js` (SQLite compiled to WebAssembly) instead of the native `better-sqlite3` addon. `npm install` therefore does not require Visual Studio, MSVC, or a C++ build toolchain.
