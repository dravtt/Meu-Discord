import { chromium } from 'playwright';
const SHOTS = process.argv[2];
const URL = process.env.NEXO_WEB ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const errors = [];
async function user(name) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 820 }, permissions: ['microphone', 'camera', 'notifications'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  return page;
}
async function register(page, username, display) {
  await page.goto(URL);
  await page.getByText('Precisa de uma conta? Cadastre-se').click();
  await page.getByLabel('Nome de usuário').fill(username);
  await page.getByLabel('Nome de exibição').fill(display);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByText('Amigos').first().waitFor();
}
const step = async (label, fn) => { process.stdout.write(`- ${label}… `); await fn(); console.log('ok'); };

const ana = await user('ana');
const bia = await user('bia');

await step('Ana se cadastra', () => register(ana, 'ana', 'Ana'));
await ana.screenshot({ path: `${SHOTS}/01-home.png` });
await step('Ana cria um servidor', async () => {
  await ana.getByLabel('Adicionar um servidor').click();
  await ana.getByText('Criar o meu').click();
  await ana.getByLabel('Nome do servidor').fill('Comunidade Nexo');
  await ana.getByRole('button', { name: 'Criar', exact: true }).click();
  await ana.getByRole('heading', { name: 'Bem-vindo a #geral!' }).waitFor();
});
await step('Ana envia mensagem formatada', async () => {
  await ana.getByPlaceholder('Conversar em #geral').fill('Olá **pessoal**! Bem-vindos ao `Nexo` 🎉');
  await ana.keyboard.press('Enter');
  await ana.locator('.message .content', { hasText: 'Bem-vindos' }).waitFor();
});
let link;
await step('Ana gera convite', async () => {
  await ana.locator('.sidebar-header').click();
  await ana.getByText('Convidar pessoas').click();
  await ana.waitForFunction(() => document.querySelector('.dialog input[readonly]')?.value.includes('#/convite/'));
  link = await ana.locator('.dialog input[readonly]').inputValue();
  await ana.screenshot({ path: `${SHOTS}/02-invite.png` });
  await ana.keyboard.press('Escape');
});
await step('Bia se cadastra e aceita o convite pelo link', async () => {
  await register(bia, 'bia', 'Bia');
  await bia.goto(link.replace('http://localhost', 'http://127.0.0.1'));
  await bia.getByRole('button', { name: 'Aceitar convite', exact: true }).click();
  await bia.locator('.message .content', { hasText: 'Bem-vindos' }).waitFor();
});
await step('Ana vê Bia na lista de membros (tempo real)', () => ana.locator('.member-list', { hasText: 'Bia' }).waitFor());
await step('Bia responde mencionando Ana com autocomplete', async () => {
  await bia.locator('.message', { hasText: 'Bem-vindos' }).first().hover();
  await bia.getByTitle('Responder').click();
  const box = bia.getByPlaceholder('Conversar em #geral');
  await box.pressSequentially('Obrigada @an');
  await bia.locator('.autocomplete button', { hasText: 'Ana' }).waitFor();
  await box.press('Enter');
  await box.pressSequentially('!');
  await box.press('Enter');
});
await step('Ana recebe a resposta com menção destacada', async () => {
  await ana.locator('.message.mentioned', { hasText: 'Obrigada' }).waitFor();
  await ana.locator('.reply-ref', { hasText: '@Ana' }).waitFor();
});
await step('Ana reage e Bia vê a reação', async () => {
  const msg = ana.locator('.message', { hasText: 'Obrigada' });
  await msg.hover();
  await msg.getByTitle('Reagir').click();
  await ana.locator('.emoji-picker button', { hasText: '🔥' }).first().click();
  await bia.locator('.reaction', { hasText: '🔥' }).waitFor();
});
await step('Indicador de digitação', async () => {
  await bia.getByPlaceholder('Conversar em #geral').pressSequentially('digitando');
  await ana.locator('.typing', { hasText: 'Bia está digitando' }).waitFor();
  await bia.getByPlaceholder('Conversar em #geral').fill('');
});
await ana.screenshot({ path: `${SHOTS}/03-chat.png` });
await step('Ana cria canal e cargo com cor', async () => {
  await ana.locator('.sidebar-header').click();
  await ana.getByText('Configurações do servidor').click();
  await ana.getByRole('button', { name: 'Cargos', exact: true }).click();
  await ana.getByRole('button', { name: 'Criar', exact: true }).click();
  await ana.getByLabel('Nome', { exact: true }).fill('Moderação');
  await ana.getByLabel('Mostrar membros com este cargo separadamente').check();
  await ana.getByLabel('Gerenciar mensagens').check();
  await ana.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await ana.locator('.role-list', { hasText: 'Moderação' }).waitFor();
  await ana.screenshot({ path: `${SHOTS}/04-roles.png` });
  await ana.getByRole('button', { name: 'Membros', exact: true }).click();
  await ana.locator('.member-admin', { hasText: 'Bia' }).locator('select').selectOption({ label: 'Moderação' });
  await ana.locator('.member-admin', { hasText: 'Bia' }).locator('.role-chip', { hasText: 'Moderação' }).waitFor();
  await ana.keyboard.press('Escape');
  await ana.locator('.member-list .section-title', { hasText: 'Moderação' }).waitFor();
});
await step('Bia (moderadora) agora pode fixar mensagens', async () => {
  const msg = bia.locator('.message', { hasText: 'Bem-vindos' }).first();
  await msg.hover();
  await msg.getByTitle('Fixar').click();
  await ana.locator('.message', { hasText: 'Bem-vindos' }).first().locator('.pinned-flag').waitFor();
});
await step('Tópico (thread)', async () => {
  const msg = ana.locator('.message', { hasText: 'Bem-vindos' }).first();
  await msg.hover();
  await msg.getByTitle('Criar tópico').click();
  await ana.getByLabel('Nome do tópico').fill('Apresentações');
  await ana.getByRole('button', { name: 'Criar', exact: true }).click();
  await ana.getByPlaceholder('Conversar em Apresentações').fill('Sou a Ana!');
  await ana.keyboard.press('Enter');
  await bia.locator('.thread-link', { hasText: 'Apresentações' }).click();
  await bia.locator('.thread-panel .message', { hasText: 'Sou a Ana' }).waitFor();
  await bia.screenshot({ path: `${SHOTS}/05-thread.png` });
  await bia.locator('.thread-panel').getByTitle('Fechar').click();
});
await step('Amizade e DM', async () => {
  await bia.getByLabel('Mensagens diretas').click();
  await bia.getByRole('button', { name: 'Adicionar amigo', exact: true }).click();
  await bia.getByPlaceholder('Digite um nome de usuário').fill('ana');
  await bia.getByRole('button', { name: 'Enviar pedido de amizade', exact: true }).click();
  await bia.getByText('Pedido enviado para ana!').waitFor();
  await ana.getByLabel('Mensagens diretas').click();
  await ana.getByRole('button', { name: /Pendente/ }).click();
  await ana.getByTitle('Aceitar').click();
  await ana.getByRole('button', { name: 'Todos', exact: true }).click();
  await ana.locator('.friend-row', { hasText: 'Bia' }).getByTitle('Mensagem').click();
  await ana.getByPlaceholder('Conversar em @Bia').fill('Oi Bia, mensagem privada');
  await ana.keyboard.press('Enter');
  await bia.locator('.dm-item', { hasText: 'Ana' }).click();
  await bia.locator('.message', { hasText: 'mensagem privada' }).waitFor();
  await bia.screenshot({ path: `${SHOTS}/06-dm.png` });
});
await step('Upload de imagem', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000001000000010080200000090916836000000174944415478da63fcffff3f0329806a8c1a35603000004c1ffd1d3a2c2c6c0000000049454e44ae426082', 'hex');
  await bia.locator('input[type=file]').first().setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await bia.keyboard.press('Enter');
  await bia.getByPlaceholder('Conversar em @Ana').press('Enter');
  await ana.locator('.attachment-img').waitFor();
});
await step('Ligação na DM: Bia recusa, depois atende', async () => {
  await ana.getByTitle('Iniciar chamada').click();
  await bia.locator('.incoming-call', { hasText: 'Ana' }).waitFor({ timeout: 10000 });
  await ana.locator('.call-status', { hasText: 'Chamando Bia' }).waitFor();
  await bia.getByTitle('Recusar').click();
  await ana.locator('.call-toast', { hasText: 'Bia recusou a chamada' }).waitFor();
  await ana.locator('.call').waitFor({ state: 'detached' });
  await ana.getByTitle('Iniciar chamada').click();
  await bia.locator('.incoming-call').waitFor({ timeout: 10000 });
  await new Promise((r) => setTimeout(r, 400));
  await bia.screenshot({ path: `${SHOTS}/09-incoming.png` });
  await bia.getByTitle('Aceitar').click();
  await bia.locator('.call-tile').nth(1).waitFor({ timeout: 15000 });
  await ana.locator('.call-tile').nth(1).waitFor({ timeout: 15000 });
  await ana.locator('.call-status.ringing').waitFor({ state: 'detached' });
  await bia.locator('.call-controls').getByTitle('Desconectar').click();
  await ana.locator('.call-tile').nth(1).waitFor({ state: 'detached', timeout: 15000 });
  await ana.locator('.call-controls').getByTitle('Desconectar').click();
});
await step('Ambas entram no canal de voz com câmera', async () => {
  for (const p of [ana, bia]) {
    await p.getByLabel('Comunidade Nexo').click();
    await p.getByRole('button', { name: 'Geral', exact: true }).click();
  }
  await ana.locator('.call-tile').nth(1).waitFor({ timeout: 15000 });
  await bia.locator('.call-tile').nth(1).waitFor({ timeout: 15000 });
  await ana.locator('.call-controls').getByTitle('Ligar câmera').click();
  await bia.locator('.call-tile video').waitFor({ timeout: 15000 });
  await ana.locator('.voice-users .voice-user').nth(1).waitFor();
  await new Promise((r) => setTimeout(r, 1500));
  await bia.screenshot({ path: `${SHOTS}/07-voice.png` });
  // Screen share gets its own tile and the spotlight.
  await ana.locator('.call-controls').getByTitle('Compartilhar tela').click();
  await bia.locator('.call-stage.focused .call-tile.screen video').waitFor({ timeout: 15000 });
  await bia.locator('.voice-user .live').waitFor();
  await new Promise((r) => setTimeout(r, 1500));
  await bia.screenshot({ path: `${SHOTS}/08-screen.png` });
  await ana.getByTitle('Desconectar').first().click();
  await bia.locator('.call-tile').nth(1).waitFor({ state: 'detached', timeout: 15000 });
});
await step('Presença: Bia fica offline para Ana ao sair', async () => {
  await ana.getByRole('button', { name: 'geral', exact: true }).click();
  await bia.context().close();
  await ana.locator('.member.offline', { hasText: 'Bia' }).waitFor({ timeout: 8000 });
});

console.log(errors.length ? `\nErros no console:\n${[...new Set(errors)].join('\n')}` : '\nSem erros no console.');
await browser.close();
