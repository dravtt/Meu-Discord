import { _electron as electron } from 'playwright';
const [appDir, shots] = process.argv.slice(2);
const app = await electron.launch({
  executablePath: `${appDir}/../node_modules/electron/dist/electron`,
  args: [appDir, '--no-sandbox'],
  env: { ...process.env, NEXO_URL: 'http://localhost:3001', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
});
const logs = [];
app.process().stdout.on('data', (d) => logs.push(String(d)));
app.process().stderr.on('data', (d) => logs.push(String(d)));
const splash = await app.firstWindow();
console.log('first window:', await splash.title(), (await splash.locator('#status').textContent().catch(() => '?')));
// Wait for the main window.
let main;
for (let i = 0; i < 40 && !main; i++) {
  for (const w of app.windows()) if ((await w.url()).startsWith('http://localhost:3001')) main = w;
  if (!main) await new Promise((r) => setTimeout(r, 500));
}
if (!main) { console.log('main window did not open', logs.join('')); process.exit(1); }
await main.getByText('Bem-vindo de volta!').waitFor();
console.log('main window loaded login');
console.log('nexoNative keys:', await main.evaluate(() => Object.keys(window.nexoNative)));
console.log('settings via IPC:', JSON.stringify(await main.evaluate(() => window.nexoNative.getSettings())));
await main.evaluate(() => { window.nexoNative.setBadge(3); window.nexoNative.notify({ title: 'Teste', body: 'Olá', channelId: 'x' }); });
await main.getByText('Precisa de uma conta? Cadastre-se').click();
await main.getByLabel('Nome de usuário').fill('desk' + (Date.now() % 100000));
await main.getByLabel('Senha', { exact: true }).fill('senha-forte-123');
await main.getByLabel('Confirmar senha', { exact: true }).fill('senha-forte-123');
await main.getByRole('button', { name: 'Continuar' }).click();
await main.getByText('Adicionar amigo').first().waitFor();
await main.screenshot({ path: `${shots}/08-desktop.png` });
console.log('logged in inside desktop app');
const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible() })));
console.log('windows:', JSON.stringify(bounds));
// Closing hides to tray instead of quitting.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
await new Promise((r) => setTimeout(r, 500));
console.log('after close:', JSON.stringify(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible() })))));
const errs = logs.join('').split('\n').filter((l) => /error/i.test(l) && !/dbus|gpu|GL|vaapi|Fontconfig|libva/i.test(l));
console.log(errs.length ? 'main-process errors:\n' + errs.slice(0, 10).join('\n') : 'no main-process errors');
await app.close();
