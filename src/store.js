// Minimal JSON-file persistence. One file, atomic-ish writes, in-memory cache.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const EMPTY = { runs: [], companies: [], contacts: [], drafts: [], events: [] };

let db = null;
let loadedMtime = 0;

function fileMtime() {
  try { return fs.statSync(DB_PATH).mtimeMs; } catch { return 0; }
}

// Re-read from disk whenever another process (CLI vs server) changed the file.
function load() {
  const mtime = fileMtime();
  if (db && mtime === loadedMtime) return db;
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    for (const k of Object.keys(EMPTY)) if (!db[k]) db[k] = [];
  } catch {
    db = structuredClone(EMPTY);
  }
  loadedMtime = mtime;
  return db;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
  loadedMtime = fileMtime();
}

export function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function insert(collection, doc) {
  const d = load();
  doc.id = doc.id || id(collection.slice(0, 3));
  doc.createdAt = doc.createdAt || new Date().toISOString();
  d[collection].push(doc);
  save();
  return doc;
}

export function update(collection, docId, patch) {
  const d = load();
  const doc = d[collection].find((x) => x.id === docId);
  if (!doc) return null;
  Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
  save();
  return doc;
}

export function get(collection, docId) {
  return load()[collection].find((x) => x.id === docId) || null;
}

export function list(collection, filter = null) {
  const items = load()[collection];
  return filter ? items.filter(filter) : items;
}

// Instrumentation: append an outcome/event record
export function logEvent(type, payload) {
  return insert('events', { type, ...payload });
}
