import express from "express";
import session from "express-session";
import passport from "passport";
import DiscordStrategy from "passport-discord";
import SQLiteStore from "connect-sqlite3";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import path from "path";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// SQLite DB setup
const db = new sqlite3.Database("./comments.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT,
    avatar TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    parent_id INTEGER,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// Session and Passport setup
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  store: new (SQLiteStore(session))(),
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy.Strategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ["identify"]
}, (accessToken, refreshToken, profile, done) => {
  // Save user to DB
  db.run(
    `INSERT OR REPLACE INTO users (id, username, avatar) VALUES (?, ?, ?)`,
    [profile.id, profile.username, profile.avatar],
    err => done(err, profile)
  );
}));

// Auth routes
app.get("/auth/discord", passport.authenticate("discord"));
app.get(
  "/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/auth/failed" }),
  (req, res) => {
    // Redirect to the main site after login (for file:// usage)
    res.redirect("/../index.html");
  }
);
app.get("/auth/logout", (req, res) => {
  req.logout(() => {
    res.json({ ok: true });
  });
});
app.get("/auth/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

// Comments API
app.get("/api/comments", (req, res) => {
  db.all(
    `SELECT c.*, u.username, u.avatar FROM comments c LEFT JOIN users u ON c.user_id = u.id ORDER BY c.created_at ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post("/api/comments", (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Not logged in" });
  const { content, parent_id } = req.body;
  db.run(
    `INSERT INTO comments (user_id, parent_id, content) VALUES (?, ?, ?)`,
    [req.user.id, parent_id || null, content],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get(
        `SELECT c.*, u.username, u.avatar FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ?`,
        [this.lastID],
        (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json(row);
        }
      );
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
