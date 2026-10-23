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
await step('Fechar DM, reabrir com mensagem nova e atalho na barra lateral', async () => {
  const item = ana.locator('.dm-item', { hasText: 'Bia' });
  await item.hover();
  await item.getByLabel('Fechar conversa').click();
  await item.waitFor({ state: 'detached' });
  await bia.getByPlaceholder('Conversar em @Ana').fill('Voltei!');
  await bia.keyboard.press('Enter');
  await item.waitFor();
  await ana.locator('.rail-dm .badge', { hasText: '1' }).waitFor();
  await ana.screenshot({ path: `${SHOTS}/10-dm-rail.png` });
  await ana.locator('.rail-dm .rail-btn').click();
  await ana.locator('.message', { hasText: 'Voltei!' }).waitFor();
  await ana.locator('.rail-dm').waitFor({ state: 'detached' });
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
await step('Menu do botão direito, nota e menus que fecham ao clicar fora', async () => {
  await ana.getByLabel('Comunidade Nexo').click();
  await ana.getByRole('button', { name: 'geral', exact: true }).click();
  await ana.locator('.member-list .member', { hasText: 'Bia' }).click({ button: 'right' });
  const menu = ana.locator('.ctx-menu');
  await menu.getByText('Adicionar nota').waitFor();
  if (await menu.getByText('Volume do usuário').count()) throw new Error('volume aparece fora da chamada');
  await ana.screenshot({ path: `${SHOTS}/11-menu.png` });
  await menu.getByText('Adicionar nota').click();
  await ana.locator('.dialog textarea').fill('Amiga do trabalho');
  await ana.getByRole('button', { name: 'Salvar', exact: true }).click();
  await ana.locator('.member-list .member', { hasText: 'Bia' }).click();
  const note = ana.locator('.note-input');
  await note.waitFor();
  if ((await note.inputValue()) !== 'Amiga do trabalho') throw new Error('nota não salva');
  await ana.keyboard.press('Escape');
  await ana.locator('.member-list .member', { hasText: 'Bia' }).click({ button: 'right' });
  await menu.waitFor();
  await ana.locator('.chat-header h3').click();
  await menu.waitFor({ state: 'detached' });
  await ana.locator('.user-panel .me').click();
  await ana.locator('.me-popout').waitFor();
  await ana.locator('.chat-header h3').click();
  await ana.locator('.me-popout').waitFor({ state: 'detached' });
  await ana.locator('.sidebar-header').click();
  await ana.locator('.dropdown').waitFor();
  await ana.locator('.chat-header h3').click();
  await ana.locator('.dropdown').waitFor({ state: 'detached' });
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
  // The fake microphone beeps: the speaking border must light up from the real audio.
  await bia.locator('.call-tile.speaking').first().waitFor({ timeout: 10000 });
  await bia.locator('.voice-user.speaking').first().waitFor({ timeout: 10000 });
  await ana.locator('.voice-user', { hasText: 'Bia' }).click({ button: 'right' });
  await ana.locator('.ctx-menu').getByText('Volume do usuário').waitFor();
  await ana.screenshot({ path: `${SHOTS}/12-volume.png` });
  await ana.keyboard.press('Escape');
  // Reloading the page keeps Ana in the same channel and back in the call.
  await ana.reload();
  await ana.locator('.channel-item.active', { hasText: 'Geral' }).waitFor({ timeout: 15000 });
  await ana.locator('.call-tile').nth(1).waitFor({ timeout: 15000 });
  await ana.locator('.call-controls').getByTitle('Ligar câmera').click();
  await bia.locator('.call-tile video').waitFor({ timeout: 15000 });
  // Soundboard: Ana plays a built-in sound and Bia sees the emoji pop on Ana's tile.
  await ana.locator('.call-controls').getByTitle('Efeitos sonoros').click();
  await ana.locator('.soundboard').getByText('ba dum tss').waitFor();
  await ana.screenshot({ path: `${SHOTS}/15-soundboard.png` });
  await ana.locator('.soundboard').getByTitle('Tocar "ba dum tss" para todos na chamada').click();
  await bia.locator('.call-tile .sound-bubble', { hasText: '🥁' }).waitFor({ timeout: 5000 });
  await ana.locator('.chat-header, .call').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await ana.locator('.soundboard').waitFor({ state: 'detached' });
  // A screen share covers the sharer's own tile (camera in the corner) and takes the spotlight.
  await ana.locator('.call-controls').getByTitle('Compartilhar tela').click();
  await ana.getByRole('button', { name: '60 FPS' }).click();
  await ana.screenshot({ path: `${SHOTS}/17-share-dialog.png` });
  await ana.getByRole('button', { name: 'Transmitir', exact: true }).click();
  await bia.locator('.call-stage.focused > .call-tile.screen > video').waitFor({ timeout: 15000 });
  await bia.locator('.call-stage.focused > .call-tile.screen .tile-pip video').waitFor({ timeout: 15000 });
  await bia.locator('.voice-user .live').waitFor();
  await new Promise((r) => setTimeout(r, 1500));
  await bia.screenshot({ path: `${SHOTS}/08-screen.png` });
  await ana.getByTitle('Desconectar').first().click();
  await bia.locator('.call-tile').nth(1).waitFor({ state: 'detached', timeout: 15000 });
});
await step('Aparência, notificações e voz', async () => {
  await ana.locator('.user-panel').getByTitle('Configurações').click();
  await ana.getByRole('button', { name: 'Aparência', exact: true }).click();
  await ana.getByRole('button', { name: 'Claro', exact: true }).click();
  if ((await ana.evaluate(() => document.documentElement.dataset.theme)) !== 'light') throw new Error('tema não aplicado');
  await ana.screenshot({ path: `${SHOTS}/13-light.png` });
  await ana.getByRole('button', { name: 'Escuro', exact: true }).click();
  await ana.getByRole('button', { name: 'Voz e vídeo', exact: true }).click();
  await ana.getByText('Apertar para falar', { exact: true }).click();
  await ana.locator('.key-capture', { hasText: 'V' }).waitFor();
  await ana.getByText('Detecção de voz', { exact: true }).click();
  await ana.getByText('Determinar automaticamente a sensibilidade de entrada').click();
  await ana.locator('.sensitivity-slider').waitFor();
  await ana.getByRole('button', { name: 'Testar microfone' }).click();
  await new Promise((r) => setTimeout(r, 1200));
  await ana.screenshot({ path: `${SHOTS}/14-voice-settings.png` });
  await ana.getByRole('button', { name: 'Parar teste' }).click();
  await ana.getByText('Determinar automaticamente a sensibilidade de entrada').click();
  await ana.getByRole('button', { name: 'Notificações', exact: true }).click();
  await ana.locator('.notify-server select').first().selectOption('mentions');
  await ana.keyboard.press('Escape');
});
await step('Perfil com banner, cores e estilo do nome (Bia vê ao vivo)', async () => {
  await ana.locator('.user-panel').getByTitle('Configurações').click();
  await ana.getByLabel('Pronomes').fill('ela/dela');
  await ana.getByLabel('Trocar banner').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAT0lEQVR4nA3JMQHAMAgAwcphiRIWbOAAB9hgQQnL20BJmlvvu8IKI7SQggsqHOG7xhpjtJGGG2ocexFsMEEHGXigwYkXxRZTdJGFF1qc4geWCjhBjoZD5QAAAABJRU5ErkJggg==', 'base64') });
  await ana.getByRole('button', { name: 'Remover banner' }).waitFor();
  await ana.getByRole('button', { name: 'Duas cores', exact: true }).click();
  await ana.getByRole('button', { name: 'Fonte Pixel' }).click();
  await ana.getByRole('button', { name: 'Gradiente', exact: true }).click();
  await ana.locator('.preview .pc-name .styled-name.font-pixel.effect-gradient').waitFor();
  // Same colors Jacques picked (white to black): text must stay readable.
  await ana.getByLabel('Primária: #ffffff').click();
  await ana.getByLabel('Secundária: #0b0b0f').click();
  await ana.locator('.preview').screenshot({ path: `${SHOTS}/15a-preview-white-black.png` });
  await ana.getByLabel('Primária: #ec4899').click();
  await ana.getByLabel('Secundária: #6366f1').click();
  // Game search goes through the API to Steam's store search; picking a result brings its cover.
  await ana.getByRole('button', { name: 'Jogo favorito' }).click();
  await ana.getByLabel('Buscar jogo').fill('rocket');
  await ana.locator('.game-results [role=option]').first().click();
  await ana.locator('.we-picked', { hasText: /rocket/i }).waitFor();
  await ana.getByLabel('Comentário').fill('sou Lenda Supersônica');
  await ana.getByRole('button', { name: 'Jogos que eu gosto' }).click();
  for (const g of ['Minecraft', 'osu!']) {
    await ana.getByLabel('Buscar jogo').fill(g);
    await ana.getByRole('button', { name: `Adicionar "${g}" sem capa` }).click();
  }
  // Games outside Steam come from Nexo's own catalog, cover included.
  await ana.getByLabel('Buscar jogo').fill('valo');
  await ana.getByRole('option', { name: 'VALORANT' }).click();
  await ana.locator('.we-game img[src="/games/valorant.jpg"]').waitFor();
  await ana.locator('.preview .widget-games figure').nth(2).waitFor();
  await ana.screenshot({ path: `${SHOTS}/15-profile-editor.png` });
  await ana.getByRole('button', { name: 'Salvar alterações' }).click();
  await ana.getByText('Perfil salvo!').waitFor();
  await ana.keyboard.press('Escape');
  await bia.getByRole('button', { name: 'geral', exact: true }).click();
  await bia.locator('.member .styled-name.font-pixel.effect-gradient', { hasText: 'Ana' }).waitFor();
  await bia.locator('.message .author .styled-name.font-pixel', { hasText: 'Ana' }).first().click();
  await bia.locator('.profile-full .profile-card.themed', { hasText: 'ela/dela' }).waitFor();
  await bia.locator('.profile-full .widget-favorite', { hasText: /rocket/i }).waitFor();
  await new Promise((r) => setTimeout(r, 400));
  await bia.screenshot({ path: `${SHOTS}/16-profile-card.png` });
  await bia.getByRole('button', { name: /Servidores em comum/ }).click();
  await bia.locator('.profile-side-body .list-row', { hasText: 'Comunidade Nexo' }).waitFor();
  await bia.keyboard.press('Escape');
  // Your own profile from the panel at the bottom left.
  await ana.locator('.user-panel .me').click();
  await ana.locator('.me-popout', { hasText: 'Ver perfil completo' }).waitFor();
  await ana.screenshot({ path: `${SHOTS}/17-me-popout.png` });
  await ana.getByRole('button', { name: 'Ver perfil completo' }).click();
  await ana.locator('.profile-full .widget-games', { hasText: 'VALORANT' }).waitFor();
  await ana.keyboard.press('Escape');
});
await step('Presença: Bia fica offline para Ana ao sair', async () => {
  await ana.getByRole('button', { name: 'geral', exact: true }).click();
  await bia.context().close();
  // The server waits ~10 s (in case it is just a page reload) before showing someone offline.
  await ana.locator('.member.offline', { hasText: 'Bia' }).waitFor({ timeout: 20000 });
});

console.log(errors.length ? `\nErros no console:\n${[...new Set(errors)].join('\n')}` : '\nSem erros no console.');
await browser.close();
