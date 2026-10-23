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
];

const byExe = new Map(KNOWN.flatMap((g) => g.exe.map((e) => [e, g])));

/** Names of the running processes, lowercased. */
function processNames() {
  return new Promise((resolve) => {
    const [cmd, args] = process.platform === 'win32' ? ['tasklist', ['/FO', 'CSV', '/NH']] : ['ps', ['-A', '-o', 'comm=']];
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 10_000 }, (err, out) => {
      if (err) return resolve([]);
      const names = out.split(/\r?\n/).map((line) => (process.platform === 'win32' ? line.split('","')[0].replace(/^"/, '') : line.split('/').pop()).trim().toLowerCase());
      resolve(names.filter(Boolean));
    });
  });
}

/** The first known game that is open right now, or null. */
async function runningGame() {
  for (const name of await processNames()) {
    const g = byExe.get(name) ?? byExe.get(`${name}.exe`);
    if (g) return { name: g.name, ...(g.steamId ? { steamId: g.steamId } : {}), ...(g.catalogId ? { catalogId: g.catalogId } : {}) };
  }
  return null;
}

module.exports = { runningGame };
