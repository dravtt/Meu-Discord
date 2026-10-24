const { execFile } = require('node:child_process');

/**
 * Games the desktop app recognizes by their process name, so "Jogando …" shows up on its own.
 * `steamId` / `catalogId` give the cover art; a game without either shows its name only.
 */
const KNOWN = [
  { exe: ['valorant-win64-shipping.exe'], name: 'VALORANT', catalogId: 'valorant' },
  { exe: ['fortniteclient-win64-shipping.exe'], name: 'Fortnite', catalogId: 'fortnite' },
  { exe: ['cs2.exe'], name: 'Counter-Strike 2', steamId: 730 },
  { exe: ['league of legends.exe'], name: 'League of Legends' },
  { exe: ['robloxplayerbeta.exe'], name: 'Roblox' },
  { exe: ['minecraft.windows.exe'], name: 'Minecraft' },
  { exe: ['gta5.exe', 'gta5_enhanced.exe'], name: 'Grand Theft Auto V', steamId: 271590 },
  { exe: ['rocketleague.exe'], name: 'Rocket League', steamId: 252950 },
  { exe: ['r5apex.exe', 'r5apex_dx12.exe'], name: 'Apex Legends', steamId: 1172470 },
  { exe: ['dota2.exe'], name: 'Dota 2', steamId: 570 },
  { exe: ['rainbowsix.exe', 'rainbowsix_vulkan.exe'], name: 'Rainbow Six Siege', steamId: 359550 },
  { exe: ['tslgame.exe'], name: 'PUBG: BATTLEGROUNDS', steamId: 578080 },
  { exe: ['overwatch.exe'], name: 'Overwatch 2', steamId: 2357570 },
  { exe: ['cod.exe'], name: 'Call of Duty', steamId: 1938090 },
  { exe: ['fc25.exe'], name: 'EA SPORTS FC 25', steamId: 2669320 },
  { exe: ['among us.exe'], name: 'Among Us', steamId: 945360 },
  { exe: ['fallguys_client_game.exe'], name: 'Fall Guys', steamId: 1097150 },
  { exe: ['deadbydaylight-win64-shipping.exe'], name: 'Dead by Daylight', steamId: 381210 },
  { exe: ['marvel-win64-shipping.exe'], name: 'Marvel Rivals', steamId: 2767030 },
  { exe: ['rustclient.exe'], name: 'Rust', steamId: 252490 },
  { exe: ['terraria.exe'], name: 'Terraria', steamId: 105600 },
  { exe: ['stardew valley.exe'], name: 'Stardew Valley', steamId: 413150 },
  { exe: ['eldenring.exe'], name: 'ELDEN RING', steamId: 1245620 },
  { exe: ['palworld-win64-shipping.exe'], name: 'Palworld', steamId: 1623730 },
  { exe: ['brawlhalla.exe'], name: 'Brawlhalla', steamId: 291550 },
  { exe: ['dayz_x64.exe', 'dayz_be.exe'], name: 'DayZ', steamId: 221100 },
];

const byExe = new Map(KNOWN.flatMap((g) => g.exe.map((e) => [e, g])));

const fs = require('node:fs');
const path = require('node:path');

/** Programs that live in game folders but are not the game itself. */
const NOT_A_GAME = /launcher|crash|anticheat|easyanticheat|battleye|beservice|redist|setup|unins|helper|updater|overlay|reporter|dxsetup|vcredist|cefprocess|webview|bootstrap|prereq/i;
const SKIP_DIRS = new Set(['steamworks shared', 'steamvr', 'steam controller configs', 'launcher', 'directxredist', 'epic online services', 'riot client']);

/** Steam libraries: "installdir" -> { steamId, name }, read from appmanifest_*.acf and cached for 10 min. */
const libraries = new Map();
function steamApps(root) {
  const cached = libraries.get(root);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.apps;
  const apps = new Map();
  try {
    for (const f of fs.readdirSync(path.join(root, 'steamapps'))) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      const text = fs.readFileSync(path.join(root, 'steamapps', f), 'utf8');
      const appid = /"appid"\s+"(\d+)"/i.exec(text)?.[1];
      const name = /"name"\s+"([^"]+)"/i.exec(text)?.[1];
      const dir = /"installdir"\s+"([^"]+)"/i.exec(text)?.[1];
      if (appid && name && dir) apps.set(dir.toLowerCase(), { steamId: Number(appid), name });
    }
  } catch { /* library not readable */ }
  libraries.set(root, { at: Date.now(), apps });
  return apps;
}

/**
 * Any game installed through Steam, Epic or Riot, recognized by the folder its program runs from.
 * Steam games also get their real name and Steam id (for the cover) from Steam's own files.
 */
function gameFromPath(full) {
  const p = full.replace(/\//g, '\\');
  const exe = p.split('\\').pop();
  if (NOT_A_GAME.test(exe)) return null;
  let m = /^(.*?)\\steamapps\\common\\([^\\]+)\\/i.exec(p);
  if (m) {
    if (SKIP_DIRS.has(m[2].toLowerCase())) return null;
    const app = steamApps(full.slice(0, m[1].length)).get(m[2].toLowerCase());
    return app ? { name: app.name, steamId: app.steamId } : { name: m[2] };
  }
  m = /\\(epic games|riot games)\\([^\\]+)\\/i.exec(p);
  if (m && !SKIP_DIRS.has(m[2].toLowerCase())) return { name: m[2] };
  return null;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15_000 }, (err, out) => resolve(err ? '' : out));
  });
}

/** Running programs: their file name (lowercased) and, on Windows, their full path when readable. */
async function processes() {
  if (process.platform !== 'win32') {
    const out = await run('ps', ['-A', '-o', 'comm=']);
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((p) => ({ name: p.split('/').pop().toLowerCase(), path: p }));
  }
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | ForEach-Object { $_.ProcessName + ".exe|" + $_.Path }']);
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, p] = l.split('|');
    return { name: name.toLowerCase(), path: p || '' };
  });
}

const pack = (g) => ({ name: g.name, ...(g.steamId ? { steamId: g.steamId } : {}), ...(g.catalogId ? { catalogId: g.catalogId } : {}) });

/** The game that is open right now (games from the known list first, then any Steam/Epic/Riot game), or null. */
async function runningGame() {
  const list = await processes();
  for (const p of list) {
    const g = byExe.get(p.name);
    if (g) return pack(g);
  }
  for (const p of list) {
    const g = p.path && gameFromPath(p.path);
    if (g) return pack(g);
  }
  return null;
}

module.exports = { runningGame, gameFromPath };
