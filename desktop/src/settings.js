const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** Small JSON settings file in the user data folder (window state, server URL, preferences). */
const file = () => path.join(app.getPath('userData'), 'settings.json');

const defaults = {
  serverUrl: process.env.NEXO_URL || 'http://localhost:3001',
  minimizeToTray: true,
  startMinimized: false,
  hardwareAcceleration: true,
  windowBounds: { width: 1280, height: 800 },
  isMaximized: false,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...defaults, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...defaults };
  }
  if (process.env.NEXO_URL) cache.serverUrl = process.env.NEXO_URL;
  return cache;
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  load()[key] = value;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Failed to save settings', err);
  }
}

module.exports = { get, set };
