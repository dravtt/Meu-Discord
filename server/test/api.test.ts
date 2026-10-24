import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, auth, connect, nextEvent, noEvent, register, startServer, stopServer, type TestUser } from './helpers.js';
import { P } from '../src/permissions.js';

let ana: TestUser, bia: TestUser, caio: TestUser;
let serverId: string, generalId: string, voiceId: string;

beforeAll(async () => {
  await startServer();
  ana = await register('ana');
  bia = await register('bia');
  caio = await register('caio');
});
afterAll(stopServer);

describe('auth', () => {
  it('rejects duplicate usernames and bad passwords', async () => {
    await api().post('/api/auth/register').send({ username: 'ANA', password: 'outra-senha-1', email: 'outra@teste.com.br', birthdate: '2000-01-01' }).expect(409);
    await api().post('/api/auth/login').send({ username: 'ana', password: 'errada-errada' }).expect(401);
    const ok = await api().post('/api/auth/login').send({ username: 'ana', password: 'senha-forte-123' }).expect(200);
    expect(ok.body.user.username).toBe('ana');
  });

  it('requires a token and updates the profile', async () => {
    await api().get('/api/users/@me').expect(401);
    const res = await api().patch('/api/users/@me').set(auth(ana)).send({ displayName: 'Ana', customStatus: 'codando' }).expect(200);
    expect(res.body).toMatchObject({ displayName: 'Ana', customStatus: 'codando' });
  });

  it('saves profile style and rejects bad values', async () => {
    const res = await api().patch('/api/users/@me').set(auth(ana)).send({
      pronouns: 'ela/dela', profileColors: ['#ff0066', '#3300aa'], bannerUrl: '/uploads/b.png',
      nameStyle: { font: 'pixel', effect: 'gradient', colors: ['#ffffff', '#00ffcc'] },
    }).expect(200);
    expect(res.body).toMatchObject({ pronouns: 'ela/dela', profileColors: ['#ff0066', '#3300aa'], bannerUrl: '/uploads/b.png', nameStyle: { font: 'pixel', effect: 'gradient', colors: ['#ffffff', '#00ffcc'] } });
    // Other edits keep the style.
    const again = await api().patch('/api/users/@me').set(auth(ana)).send({ bio: 'oi', bannerUrl: null }).expect(200);
    expect(again.body).toMatchObject({ bannerUrl: null, nameStyle: { font: 'pixel' }, profileColors: ['#ff0066', '#3300aa'] });
    await api().patch('/api/users/@me').set(auth(ana)).send({ profileColors: ['red'] }).expect(400);
    await api().patch('/api/users/@me').set(auth(ana)).send({ profileColors: ['#000000', '#111111', '#222222'] }).expect(400);
    await api().patch('/api/users/@me').set(auth(ana)).send({ nameStyle: { font: 'comic', effect: 'solid', colors: [] } }).expect(400);
    await api().patch('/api/users/@me').set(auth(ana)).send({ bannerUrl: 'https://evil.example/x.png' }).expect(400);
    await api().patch('/api/users/@me').set(auth(ana)).send({ nameStyle: { font: 'default', effect: 'solid', colors: [] }, profileColors: [] }).expect(200);
    const w = [{ type: 'favorite', game: { name: 'Rocket League', cover: null }, note: 'sou Lenda' }, { type: 'games', games: [{ name: 'Minecraft', cover: '/uploads/m.png' }] }];
    expect((await api().patch('/api/users/@me').set(auth(ana)).send({ widgets: w }).expect(200)).body.widgets).toEqual(w);
    expect((await api().get(`/api/users/${ana.id}`).set(auth(ana)).expect(200)).body.widgets).toEqual(w);
    await api().patch('/api/users/@me').set(auth(ana)).send({ widgets: [{ type: 'games', games: [{ name: 'x', cover: 'javascript:1' }] }] }).expect(400);
    await api().patch('/api/users/@me').set(auth(ana)).send({ widgets: [{ type: 'hack' }] }).expect(400);
  });
});

describe('servers, invites and channels', () => {
  it('creates a server with default channels and roles', async () => {
    const res = await api().post('/api/servers').set(auth(ana)).send({ name: 'Nexo HQ' }).expect(201);
    serverId = res.body.id;
    expect(res.body.roles.map((r: any) => r.name)).toEqual(['@everyone']);
    const types = res.body.channels.map((c: any) => c.type).sort();
    expect(types).toEqual(['category', 'category', 'text', 'voice']);
    generalId = res.body.channels.find((c: any) => c.type === 'text').id;
    voiceId = res.body.channels.find((c: any) => c.type === 'voice').id;
  });

  it('hides the server from non-members and lets them join by invite', async () => {
    await api().get(`/api/servers/${serverId}`).set(auth(bia)).expect(404);
    await api().get(`/api/channels/${generalId}/messages`).set(auth(bia)).expect(404);
    const inv = await api().post(`/api/servers/${serverId}/invites`).set(auth(ana)).send({}).expect(201);
    const preview = await api().get(`/api/invites/${inv.body.code}`).set(auth(bia)).expect(200);
    expect(preview.body.server).toMatchObject({ name: 'Nexo HQ', memberCount: 1 });

    const anaSocket = await connect(ana);
    const added = nextEvent(anaSocket, 'member:add');
    await api().post(`/api/invites/${inv.body.code}`).set(auth(bia)).expect(200);
    expect((await added).user.id).toBe(bia.id);
    anaSocket.close();
    await api().post(`/api/invites/${inv.body.code}`).set(auth(caio)).expect(200);
  });

  it('enforces invite max uses', async () => {
    const inv = await api().post(`/api/servers/${serverId}/invites`).set(auth(ana)).send({ maxUses: 1 }).expect(201);
    const dora = await register('dora');
    const eva = await register('eva');
    await api().post(`/api/invites/${inv.body.code}`).set(auth(dora)).expect(200);
    await api().post(`/api/invites/${inv.body.code}`).set(auth(eva)).expect(404);
  });

  it('only lets members with MANAGE_CHANNELS create channels', async () => {
    await api().post(`/api/servers/${serverId}/channels`).set(auth(bia)).send({ name: 'nope' }).expect(403);
    const res = await api().post(`/api/servers/${serverId}/channels`).set(auth(ana)).send({ name: 'Anúncios Gerais' }).expect(201);
    expect(res.body.name).toBe('anúncios-gerais');
  });
});

describe('messages', () => {
  it('delivers messages in real time with mentions and replies', async () => {
    const biaSocket = await connect(bia);
    const created = nextEvent(biaSocket, 'message:create');
    const first = await api().post(`/api/channels/${generalId}/messages`).set(auth(ana)).send({ content: `oi <@${bia.id}>!` }).expect(201);
    const event = await created;
    expect(event).toMatchObject({ content: `oi <@${bia.id}>!`, mentions: [bia.id] });
    expect(event.author.username).toBe('ana');

    const reply = await api().post(`/api/channels/${generalId}/messages`).set(auth(bia)).send({ content: 'olá', replyToId: first.body.id }).expect(201);
    expect(reply.body.replyTo).toMatchObject({ id: first.body.id, authorId: ana.id });
    biaSocket.close();

    const list = await api().get(`/api/channels/${generalId}/messages`).set(auth(caio)).expect(200);
    expect(list.body.map((m: any) => m.content)).toEqual([`oi <@${bia.id}>!`, 'olá']);
  });

  it('tracks unread mentions and clears them on ack', async () => {
    let states = (await api().get('/api/read-states').set(auth(bia)).expect(200)).body;
    // Bia replied after the mention, which marks the channel read for her.
    expect(states.find((s: any) => s.channelId === generalId)).toMatchObject({ unread: false, mentions: 0 });
    await api().post(`/api/channels/${generalId}/messages`).set(auth(ana)).send({ content: `<@${bia.id}> de novo` }).expect(201);
    states = (await api().get('/api/read-states').set(auth(bia)).expect(200)).body;
    expect(states.find((s: any) => s.channelId === generalId)).toMatchObject({ unread: true, mentions: 1 });
    await api().post(`/api/channels/${generalId}/ack`).set(auth(bia)).expect(204);
    states = (await api().get('/api/read-states').set(auth(bia)).expect(200)).body;
    expect(states.find((s: any) => s.channelId === generalId)).toMatchObject({ unread: false, mentions: 0 });
  });

  it('only lets authors edit, and moderators delete', async () => {
    const msg = await api().post(`/api/channels/${generalId}/messages`).set(auth(bia)).send({ content: 'errro' }).expect(201);
    await api().patch(`/api/channels/${generalId}/messages/${msg.body.id}`).set(auth(caio)).send({ content: 'x' }).expect(403);
    const edited = await api().patch(`/api/channels/${generalId}/messages/${msg.body.id}`).set(auth(bia)).send({ content: 'erro' }).expect(200);
    expect(edited.body.editedAt).not.toBeNull();
    await api().delete(`/api/channels/${generalId}/messages/${msg.body.id}`).set(auth(caio)).expect(403);
    await api().delete(`/api/channels/${generalId}/messages/${msg.body.id}`).set(auth(ana)).expect(204);
  });

  it('toggles reactions and pins', async () => {
    const msg = await api().post(`/api/channels/${generalId}/messages`).set(auth(ana)).send({ content: 'reaja' }).expect(201);
    const emoji = encodeURIComponent('🔥');
    await api().put(`/api/channels/${generalId}/messages/${msg.body.id}/reactions/${emoji}`).set(auth(bia)).expect(204);
    await api().put(`/api/channels/${generalId}/messages/${msg.body.id}/reactions/${emoji}`).set(auth(caio)).expect(204);
    let list = (await api().get(`/api/channels/${generalId}/messages`).set(auth(bia)).expect(200)).body;
    expect(list.at(-1).reactions).toEqual([{ emoji: '🔥', count: 2, me: true }]);
    await api().delete(`/api/channels/${generalId}/messages/${msg.body.id}/reactions/${emoji}`).set(auth(bia)).expect(204);
    list = (await api().get(`/api/channels/${generalId}/messages`).set(auth(bia)).expect(200)).body;
    expect(list.at(-1).reactions).toEqual([{ emoji: '🔥', count: 1, me: false }]);

    await api().put(`/api/channels/${generalId}/pins/${msg.body.id}`).set(auth(bia)).expect(403);
    await api().put(`/api/channels/${generalId}/pins/${msg.body.id}`).set(auth(ana)).expect(204);
    const pins = await api().get(`/api/channels/${generalId}/pins`).set(auth(caio)).expect(200);
    expect(pins.body.map((m: any) => m.id)).toEqual([msg.body.id]);
  });

  it('uploads attachments', async () => {
    const res = await api().post(`/api/channels/${generalId}/messages`).set(auth(bia))
      .field('content', 'arquivo').attach('files', Buffer.from('hello'), 'nota.txt').expect(201);
    expect(res.body.attachments[0]).toMatchObject({ filename: 'nota.txt', size: 5 });
    await api().get(res.body.attachments[0].url).expect(200);
  });

  it('creates threads and searches', async () => {
    const msg = await api().post(`/api/channels/${generalId}/messages`).set(auth(caio)).send({ content: 'vamos discutir o roadmap' }).expect(201);
    const thread = await api().post(`/api/channels/${generalId}/messages/${msg.body.id}/threads`).set(auth(bia)).send({ name: 'Roadmap' }).expect(201);
    await api().post(`/api/channels/${thread.body.id}/messages`).set(auth(ana)).send({ content: 'primeiro item do roadmap' }).expect(201);
    const threads = await api().get(`/api/channels/${generalId}/threads`).set(auth(caio)).expect(200);
    expect(threads.body.map((t: any) => t.name)).toEqual(['Roadmap']);
    const found = await api().get(`/api/servers/${serverId}/messages/search`).query({ q: 'ROADMAP' }).set(auth(caio)).expect(200);
    expect(found.body).toHaveLength(2);
  });
});

describe('roles and permissions', () => {
  let modRoleId: string, privateId: string;

  it('creates a private channel hidden from regular members', async () => {
    const res = await api().post(`/api/servers/${serverId}/channels`).set(auth(ana)).send({ name: 'staff', private: true }).expect(201);
    privateId = res.body.id;
    await api().get(`/api/channels/${privateId}/messages`).set(auth(bia)).expect(404);
    const snap = await api().get(`/api/servers/${serverId}`).set(auth(bia)).expect(200);
    expect(snap.body.channels.some((c: any) => c.id === privateId)).toBe(false);

    const biaSocket = await connect(bia);
    const leaked = noEvent(biaSocket, 'message:create');
    await api().post(`/api/channels/${privateId}/messages`).set(auth(ana)).send({ content: 'segredo' }).expect(201);
    expect(await leaked).toBe(true);
    biaSocket.close();
  });

  it('grants access through a role overwrite and role permissions', async () => {
    const role = await api().post(`/api/servers/${serverId}/roles`).set(auth(ana))
      .send({ name: 'Moderação', color: '#e67e22', permissions: P.MANAGE_MESSAGES | P.KICK_MEMBERS, hoist: true }).expect(201);
    modRoleId = role.body.id;
    await api().put(`/api/channels/${privateId}/overwrites/${modRoleId}`).set(auth(ana)).send({ type: 'role', allow: P.VIEW_CHANNEL, deny: 0 }).expect(204);
    await api().put(`/api/servers/${serverId}/members/${bia.id}/roles/${modRoleId}`).set(auth(ana)).expect(200);
    const list = await api().get(`/api/channels/${privateId}/messages`).set(auth(bia)).expect(200);
    expect(list.body.map((m: any) => m.content)).toEqual(['segredo']);
    // Bia can now delete others' messages but cannot create roles or grant permissions she lacks.
    await api().post(`/api/servers/${serverId}/roles`).set(auth(bia)).send({ name: 'x' }).expect(403);
  });

  it('respects role hierarchy for kicks', async () => {
    await api().delete(`/api/servers/${serverId}/members/${bia.id}`).set(auth(caio)).expect(403);
    await api().delete(`/api/servers/${serverId}/members/${ana.id}`).set(auth(bia)).expect(403);
    const caioSocket = await connect(caio);
    const removed = nextEvent(caioSocket, 'server:delete');
    await api().delete(`/api/servers/${serverId}/members/${caio.id}`).set(auth(bia)).expect(204);
    expect(await removed).toMatchObject({ id: serverId, reason: 'kick' });
    caioSocket.close();
    await api().get(`/api/servers/${serverId}`).set(auth(caio)).expect(404);
  });

  it('bans block rejoining', async () => {
    await api().put(`/api/servers/${serverId}/bans/${caio.id}`).set(auth(ana)).send({ reason: 'spam' }).expect(204);
    const inv = await api().post(`/api/servers/${serverId}/invites`).set(auth(ana)).send({}).expect(201);
    await api().post(`/api/invites/${inv.body.code}`).set(auth(caio)).expect(403);
    await api().delete(`/api/servers/${serverId}/bans/${caio.id}`).set(auth(ana)).expect(204);
    await api().post(`/api/invites/${inv.body.code}`).set(auth(caio)).expect(200);
  });

  it('prevents the owner from leaving and lets others leave', async () => {
    await api().delete(`/api/servers/${serverId}/members/@me`).set(auth(ana)).expect(400);
    await api().delete(`/api/servers/${serverId}/members/@me`).set(auth(caio)).expect(204);
  });
});

describe('friends and DMs', () => {
  it('sends and accepts friend requests', async () => {
    const biaSocket = await connect(bia);
    const update = nextEvent(biaSocket, 'relationships');
    await api().post('/api/relationships').set(auth(ana)).send({ username: 'bia' }).expect(200);
    expect((await update).find((r: any) => r.user.id === ana.id).type).toBe('incoming');
    biaSocket.close();
    const res = await api().put(`/api/relationships/${ana.id}`).set(auth(bia)).expect(200);
    expect(res.body.find((r: any) => r.user.id === ana.id).type).toBe('friend');
  });

  it('opens one DM per pair and delivers messages to recipients', async () => {
    const dm = await api().post('/api/dms').set(auth(ana)).send({ userIds: [bia.id] }).expect(201);
    const again = await api().post('/api/dms').set(auth(bia)).send({ userIds: [ana.id] }).expect(200);
    expect(again.body.id).toBe(dm.body.id);
    const biaSocket = await connect(bia);
    const msg = nextEvent(biaSocket, 'message:create');
    await api().post(`/api/channels/${dm.body.id}/messages`).set(auth(ana)).send({ content: 'psiu' }).expect(201);
    expect((await msg).channelId).toBe(dm.body.id);
    biaSocket.close();
    await api().get(`/api/channels/${dm.body.id}/messages`).set(auth(caio)).expect(404);
  });

  it('blocks stop DMs and group DMs require friends', async () => {
    await api().post('/api/dms').set(auth(ana)).send({ userIds: [bia.id, caio.id] }).expect(403);
    const dm = await api().post('/api/dms').set(auth(caio)).send({ userIds: [ana.id] }).expect(201);
    await api().post(`/api/relationships/${caio.id}/block`).set(auth(ana)).expect(200);
    await api().post(`/api/channels/${dm.body.id}/messages`).set(auth(caio)).send({ content: 'oi?' }).expect(403);
  });
});

describe('presence and voice', () => {
  it('broadcasts presence to server members', async () => {
    const anaSocket = await connect(ana);
    const online = nextEvent(anaSocket, 'presence');
    const biaSocket = await connect(bia);
    expect(await online).toMatchObject({ userId: bia.id, status: 'online' });
    const offline = nextEvent(anaSocket, 'presence');
    biaSocket.close();
    expect(await offline).toMatchObject({ userId: bia.id, status: 'offline' });
    anaSocket.close();
  });

  it('issues LiveKit tokens and tracks voice states', async () => {
    const anaSocket = await connect(ana);
    const state = nextEvent(anaSocket, 'voice:state');
    const res = await api().post(`/api/channels/${voiceId}/voice`).set(auth(bia)).expect(200);
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(await state).toMatchObject({ userId: bia.id, channelId: voiceId, left: false });
    const snap = await api().get(`/api/servers/${serverId}`).set(auth(ana)).expect(200);
    expect(snap.body.voiceStates.map((v: any) => v.userId)).toEqual([bia.id]);
    const left = nextEvent(anaSocket, 'voice:state');
    await api().delete('/api/voice').set(auth(bia)).expect(204);
    expect(await left).toMatchObject({ userId: bia.id, left: true });
    await api().post(`/api/channels/${generalId}/voice`).set(auth(bia)).expect(400);
    anaSocket.close();
  });

  it('rings the other person in a DM call until they answer, decline or the caller hangs up', async () => {
    const dm = (await api().post('/api/dms').set(auth(ana)).send({ userIds: [bia.id] })).body;
    const [anaSocket, biaSocket] = await Promise.all([connect(ana), connect(bia)]);

    // Bia declines: the caller is told and the ringing stops for everyone.
    let ring = nextEvent(biaSocket, 'call:ring');
    let res = await api().post(`/api/channels/${dm.id}/voice`).set(auth(ana)).expect(200);
    expect(res.body.ringing).toBe(true);
    expect(await ring).toEqual({ channelId: dm.id, callerId: ana.id });
    const declined = nextEvent(anaSocket, 'call:declined');
    const stop = nextEvent(anaSocket, 'call:stop');
    await api().post(`/api/channels/${dm.id}/call/decline`).set(auth(bia)).expect(204);
    expect(await declined).toEqual({ channelId: dm.id, userId: bia.id });
    expect(await stop).toMatchObject({ channelId: dm.id, reason: 'declined' });
    await api().delete('/api/voice').set(auth(ana)).expect(204);

    // Bia answers by joining; joining a call already going on does not ring again.
    ring = nextEvent(biaSocket, 'call:ring');
    await api().post(`/api/channels/${dm.id}/voice`).set(auth(ana)).expect(200);
    await ring;
    const answered = nextEvent(anaSocket, 'call:stop');
    res = await api().post(`/api/channels/${dm.id}/voice`).set(auth(bia)).expect(200);
    expect(res.body.ringing).toBe(false);
    expect(await answered).toMatchObject({ reason: 'answered' });
    await api().delete('/api/voice').set(auth(bia)).expect(204);
    await api().delete('/api/voice').set(auth(ana)).expect(204);

    // Ana hangs up before Bia answers.
    ring = nextEvent(biaSocket, 'call:ring');
    await api().post(`/api/channels/${dm.id}/voice`).set(auth(ana)).expect(200);
    await ring;
    const cancelled = nextEvent(biaSocket, 'call:stop');
    await api().delete('/api/voice').set(auth(ana)).expect(204);
    expect(await cancelled).toMatchObject({ reason: 'cancelled' });

    anaSocket.close();
    biaSocket.close();
  });
});

describe('DM close, notes and server order', () => {
  it('closes a DM until a new message reopens it', async () => {
    const dm = (await api().post('/api/dms').set(auth(ana)).send({ userIds: [bia.id] })).body;
    await api().delete(`/api/dms/${dm.id}`).set(auth(bia)).expect(204);
    let list = (await api().get('/api/dms').set(auth(bia)).expect(200)).body;
    expect(list.map((d: any) => d.id)).not.toContain(dm.id);
    const biaSocket = await connect(bia);
    const reopened = nextEvent(biaSocket, 'dm:create');
    await api().post(`/api/channels/${dm.id}/messages`).set(auth(ana)).send({ content: 'volta!' }).expect(201);
    expect((await reopened).id).toBe(dm.id);
    list = (await api().get('/api/dms').set(auth(bia)).expect(200)).body;
    expect(list.map((d: any) => d.id)).toContain(dm.id);
    biaSocket.close();
  });

  it('closing a DM keeps the friendship', async () => {
    const dm = (await api().post('/api/dms').set(auth(ana)).send({ userIds: [bia.id] })).body;
    await api().delete(`/api/dms/${dm.id}`).set(auth(ana)).expect(204);
    const rel = (await api().get('/api/relationships').set(auth(ana)).expect(200)).body;
    expect(rel.find((r: any) => r.user.id === bia.id)?.type).toBe('friend');
  });

  it('posts a notice in the group when someone joins or leaves', async () => {
    const fabi = await register('fabi');
    await api().put(`/api/relationships/${fabi.id}`).set(auth(ana)).expect(200);
    await api().put(`/api/relationships/${ana.id}`).set(auth(fabi)).expect(200);
    const group = (await api().post('/api/dms').set(auth(ana)).send({ userIds: [bia.id] }).expect(200)).body;
    const g = (await api().post('/api/dms').set(auth(ana)).send({ userIds: [bia.id, fabi.id] }).expect(201)).body;
    expect(g.id).not.toBe(group.id);
    const anaSocket = await connect(ana);
    const left = nextEvent(anaSocket, 'message:create');
    await api().delete(`/api/dms/${g.id}/recipients/@me`).set(auth(fabi)).expect(204);
    expect(await left).toMatchObject({ channelId: g.id, kind: 'member_leave', content: 'saiu do grupo.', author: { id: fabi.id } });
    const added = nextEvent(anaSocket, 'message:create');
    await api().put(`/api/dms/${g.id}/recipients/${fabi.id}`).set(auth(ana)).expect(200);
    expect(await added).toMatchObject({ kind: 'member_add', content: 'adicionou fabi ao grupo.' });
    anaSocket.close();
    const msgs = (await api().get(`/api/channels/${g.id}/messages`).set(auth(bia)).expect(200)).body;
    await api().patch(`/api/channels/${g.id}/messages/${msgs[0].id}`).set(auth(fabi)).send({ content: 'x' }).expect(403);
    const biaSocket = await connect(bia);
    const icon = nextEvent(biaSocket, 'message:create');
    const upd = await api().patch(`/api/dms/${g.id}`).set(auth(fabi)).send({ iconUrl: '/uploads/x.png' }).expect(200);
    expect(upd.body.iconUrl).toBe('/uploads/x.png');
    expect(await icon).toMatchObject({ kind: 'group_icon' });
    biaSocket.close();
    await api().patch(`/api/dms/${g.id}`).set(auth(fabi)).send({ iconUrl: 'https://evil.example/x.png' }).expect(400);
  });

  it('keeps private notes and the server order', async () => {
    await api().put(`/api/users/${bia.id}/note`).set(auth(ana)).send({ note: 'amiga da escola' }).expect(200);
    expect((await api().get(`/api/users/${bia.id}`).set(auth(ana)).expect(200)).body.note).toBe('amiga da escola');
    expect((await api().get(`/api/users/${bia.id}`).set(auth(caio)).expect(200)).body.note).toBe('');
    await api().put('/api/users/@me/server-order').set(auth(ana)).send({ serverIds: [serverId] }).expect(204);
    expect((await api().get('/api/users/@me').set(auth(ana)).expect(200)).body.serverOrder).toEqual([serverId]);
  });
});

describe('soundboard', () => {
  it('uploads a sound, plays it for the call and lets the uploader delete it', async () => {
    const wav = Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex');
    await api().post(`/api/servers/${serverId}/sounds`).set(auth(bia)).field('name', 'oi').attach('file', Buffer.from('nope'), { filename: 'x.txt', contentType: 'text/plain' }).expect(400);
    const up = await api().post(`/api/servers/${serverId}/sounds`).set(auth(bia)).field('name', 'Risada').field('emoji', '😂')
      .attach('file', wav, { filename: 'r.wav', contentType: 'audio/wav' }).expect(201);
    expect(up.body).toMatchObject({ name: 'Risada', emoji: '😂', serverId });
    const list = (await api().get(`/api/servers/${serverId}/sounds`).set(auth(ana)).expect(200)).body;
    expect(list.sounds.map((s: any) => s.id)).toContain(up.body.id);

    await api().post('/api/voice/soundboard').set(auth(bia)).send({ builtin: 'buzina' }).expect(400);
    await api().post(`/api/channels/${voiceId}/voice`).set(auth(bia)).expect(200);
    const anaSocket = await connect(ana);
    const played = nextEvent(anaSocket, 'soundboard:play');
    await api().post('/api/voice/soundboard').set(auth(bia)).send({ soundId: up.body.id }).expect(204);
    expect(await played).toMatchObject({ channelId: voiceId, userId: bia.id, soundId: up.body.id, url: up.body.url });
    await new Promise((r) => setTimeout(r, 150));
    await api().post('/api/voice/soundboard').set(auth(bia)).send({ builtin: 'nao-existe' }).expect(400);
    await api().post('/api/voice/soundboard').set(auth(bia)).send({ builtin: 'tambor' }).expect(204);
    await new Promise((r) => setTimeout(r, 150));
    await api().post('/api/voice/soundboard').set(auth(bia)).send({ builtin: 'pato' }).expect(204);
    await api().delete('/api/voice').set(auth(bia)).expect(204);
    anaSocket.close();

    const gil = await register('gil');
    const inv = await api().post(`/api/servers/${serverId}/invites`).set(auth(ana)).send({}).expect(201);
    await api().post(`/api/invites/${inv.body.code}`).set(auth(gil)).expect(200);
    await api().delete(`/api/servers/${serverId}/sounds/${up.body.id}`).set(auth(gil)).expect(403);
    await api().delete(`/api/servers/${serverId}/sounds/${up.body.id}`).set(auth(bia)).expect(204);
  });
});

describe('category permission sync', () => {
  it('channels without overwrites follow a private category', async () => {
    const srv = await api().post('/api/servers').set(auth(ana)).send({ name: 'Sync' }).expect(201);
    const inv = await api().post(`/api/servers/${srv.body.id}/invites`).set(auth(ana)).send({}).expect(201);
    await api().post(`/api/invites/${inv.body.code}`).set(auth(bia)).expect(200);
    const cat = await api().post(`/api/servers/${srv.body.id}/channels`).set(auth(ana)).send({ name: 'Staff', type: 'category', private: true }).expect(201);
    const child = await api().post(`/api/servers/${srv.body.id}/channels`).set(auth(ana)).send({ name: 'avisos', parentId: cat.body.id }).expect(201);
    await api().get(`/api/channels/${child.body.id}/messages`).set(auth(bia)).expect(404);
    await api().get(`/api/channels/${child.body.id}/messages`).set(auth(ana)).expect(200);
  });

  it('uploads images for avatars', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f6f0000000049454e44ae426082', 'hex');
    const res = await api().post('/api/uploads/image').set(auth(ana)).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    await api().patch('/api/users/@me').set(auth(ana)).send({ avatarUrl: res.body.url }).expect(200);
    await api().post('/api/uploads/image').set(auth(ana)).attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
  });
});

describe('game search', () => {
  it('returns Steam apps and survives Steam being down', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { type: 'app', id: 252950, name: 'Rocket League®' }, { type: 'sub', id: 1, name: 'Pacote' },
    ] }))) as typeof fetch;
    try {
      const res = await api().get('/api/games/search?q=rocket').set(auth(ana)).expect(200);
      expect(res.body.games).toEqual([{ steamId: 252950, name: 'Rocket League' }]);
      globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
      expect((await api().get('/api/games/search?q=minecraft').set(auth(ana)).expect(200)).body).toMatchObject({ games: [], unavailable: true });
      expect((await api().get('/api/games/search?q=valo').set(auth(ana)).expect(200)).body.games[0]).toEqual({ catalogId: 'valorant', name: 'VALORANT' });
      await api().get('/api/games/search?q=a').set(auth(ana)).expect(400);
    } finally { globalThis.fetch = real; }
    const w = [{ type: 'games', games: [{ name: 'Rocket League', cover: null, steamId: 252950 }] }];
    expect((await api().patch('/api/users/@me').set(auth(ana)).send({ widgets: w }).expect(200)).body.widgets).toEqual(w);
  });
});

describe('account safety', () => {
  const sign = (username: string, extra: Record<string, unknown> = {}) =>
    api().post('/api/auth/register').send({ username, password: 'senha-forte-123', email: `${username}@teste.com.br`, birthdate: '2001-05-10', ...extra });

  it('validates e-mail and age on sign up, and logs in by e-mail', async () => {
    expect((await sign('semmail', { email: 'nao-e-email' }).expect(400)).body.error).toBe('Digite um e-mail válido');
    await sign('descartavel', { email: 'x@mailinator.com' }).expect(400);
    await sign('crianca', { birthdate: new Date(Date.now() - 5 * 365 * 86400000).toISOString().slice(0, 10) }).expect(400);
    await sign('outraana', { email: 'ana@teste.com.br' }).expect(409);
    const ok = await api().post('/api/auth/login').send({ username: 'ANA@teste.com.br', password: 'senha-forte-123' }).expect(200);
    expect(ok.body.user.id).toBe(ana.id);
  });

  it('blocks the app until the e-mail code is confirmed', async () => {
    const { config } = await import('../src/config.js');
    const { pool } = await import('../src/db.js');
    config.emailVerification = true;
    try {
      const res = await sign('duda').expect(201);
      const h = { Authorization: `Bearer ${res.body.token}` };
      const me = await api().get('/api/users/@me').set(h).expect(200);
      expect(me.body).toMatchObject({ email: 'duda@teste.com.br', emailVerified: false });
      expect((await api().get('/api/servers').set(h).expect(403)).body.code).toBe('email_unverified');
      await api().post('/api/users/@me/email/verify').set(h).send({ code: '000000' }).expect(400);
      const { rows } = await pool.query("SELECT email_code FROM users WHERE username = 'duda'");
      await api().post('/api/users/@me/email/verify').set(h).send({ code: rows[0].email_code }).expect(200);
      await api().get('/api/servers').set(h).expect(200);
    } finally { config.emailVerification = false; }
  });

  it('lets the username change once every two weeks and frees nothing taken', async () => {
    const u = await register('elis');
    await api().put('/api/users/@me/username').set(auth(u)).send({ username: 'bia', password: 'senha-forte-123' }).expect(409);
    await api().put('/api/users/@me/username').set(auth(u)).send({ username: 'elis2', password: 'errada-errada' }).expect(400);
    await api().put('/api/users/@me/username').set(auth(u)).send({ username: 'elis2', password: 'senha-forte-123' }).expect(200);
    await api().put('/api/users/@me/username').set(auth(u)).send({ username: 'elis3', password: 'senha-forte-123' }).expect(429);
    await sign('elis2').expect(409);
  });

  it('caps how many servers someone can be in', async () => {
    const { config } = await import('../src/config.js');
    const u = await register('fred');
    const max = config.maxServersPerUser;
    config.maxServersPerUser = 1;
    try {
      await api().post('/api/servers').set(auth(u)).send({ name: 'Primeiro' }).expect(201);
      expect((await api().post('/api/servers').set(auth(u)).send({ name: 'Segundo' }).expect(403)).body.error).toMatch(/máximo/);
    } finally { config.maxServersPerUser = max; }
  });

  it('keeps minors out of +18 servers', async () => {
    const owner = await register('guto');
    const kid = await sign('kid', { birthdate: new Date(Date.now() - 15 * 365.25 * 86400000).toISOString().slice(0, 10) }).expect(201);
    const kidAuth = { Authorization: `Bearer ${kid.body.token}` };
    const s = await api().post('/api/servers').set(auth(owner)).send({ name: 'Adultos' }).expect(201);
    const patched = await api().patch(`/api/servers/${s.body.id}`).set(auth(owner)).send({ nsfw: true }).expect(200);
    expect(patched.body.nsfw).toBe(true);
    const inv = await api().post(`/api/servers/${s.body.id}/invites`).set(auth(owner)).send({}).expect(201);
    expect((await api().get(`/api/invites/${inv.body.code}`).set(kidAuth).expect(200)).body.server.nsfw).toBe(true);
    await api().post(`/api/invites/${inv.body.code}`).set(kidAuth).expect(403);
    await api().post(`/api/invites/${inv.body.code}`).set(auth(ana)).expect(200);
  });

  it('shows the game someone is playing (only while online) and the badges they keep', async () => {
    const { pool } = await import('../src/db.js');
    const watcher = await connect(ana);
    try {
      await api().put(`/api/relationships/${bia.id}`).set(auth(ana));
      await api().put(`/api/relationships/${ana.id}`).set(auth(bia));
      const sock = await connect(bia);
      const ev = nextEvent(watcher, 'presence');
      // The desktop app reports the game (source auto only).
      const r = await api().put('/api/users/@me/activity').set(auth(bia)).send({ name: 'VALORANT', catalogId: 'valorant', source: 'auto' }).expect(200);
      expect(r.body.activity).toMatchObject({ name: 'VALORANT' });
      expect((await ev).activity).toMatchObject({ name: 'VALORANT' });
      // There is no manual source.
      await api().put('/api/users/@me/activity').set(auth(bia)).send({ name: 'Jogo', source: 'manual' }).expect(400);
      // While not Disponível, the activity is not stored or shown.
      await api().patch('/api/users/@me').set(auth(bia)).send({ status: 'idle' }).expect(200);
      expect((await api().put('/api/users/@me/activity').set(auth(bia)).send({ name: 'CS2', steamId: 730, source: 'auto' })).body.activity).toBeNull();
      expect((await api().get(`/api/users/${bia.id}`).set(auth(ana))).body.activity).toBeNull();
      await api().patch('/api/users/@me').set(auth(bia)).send({ status: 'online' }).expect(200);
      await api().delete('/api/users/@me/activity').set(auth(bia)).expect(204);
      sock.close();
    } finally { watcher.close(); }
    const me = await api().get('/api/users/@me').set(auth(ana)).expect(200);
    expect(me.body.badges).toEqual(expect.arrayContaining(['founder', 'beta', 'pioneer']));
    await api().put('/api/users/@me/badges').set(auth(ana)).send({ hidden: ['founder', 'beta'] }).expect(200);
    const seen = await api().get(`/api/users/${ana.id}`).set(auth(bia)).expect(200);
    expect(seen.body.badges).not.toContain('founder');
    expect(seen.body.badges).not.toContain('beta');
    expect(seen.body.badges).toContain('pioneer');
    await api().put('/api/users/@me/badges').set(auth(ana)).send({ hidden: [] }).expect(200);
  });

  it('adds up weekly play time and shows the most played games', async () => {
    const { pool } = await import('../src/db.js');
    const gamer = await register('gamezao');
    await pool.query(
      `INSERT INTO game_play (user_id, week, game_key, name, steam_id, minutes) VALUES
         ($1, date_trunc('week', now())::date, 's:730', 'Counter-Strike 2', 730, 300),
         ($1, date_trunc('week', now())::date, 'c:valorant', 'VALORANT', NULL, 120)`, [gamer.id]);
    const me = await api().get('/api/users/@me').set(auth(gamer)).expect(200);
    expect(me.body.topGames[0]).toMatchObject({ name: 'Counter-Strike 2', minutes: 300 });
    const seen = await api().get(`/api/users/${gamer.id}`).set(auth(ana)).expect(200);
    expect(seen.body.topGames.map((g: any) => g.name)).toEqual(['Counter-Strike 2', 'VALORANT']);
  });
});

describe('moderation', () => {
  it('mutes after repeated spam and logs it for the server', async () => {
    const { config } = await import('../src/config.js');
    const { resetStrikes } = await import('../src/guard.js');
    const spammer = await register('spam1');
    const owner = await register('dono1');
    const s = await api().post('/api/servers').set(auth(owner)).send({ name: 'Anti spam' }).expect(201);
    const inv = await api().post(`/api/servers/${s.body.id}/invites`).set(auth(owner)).send({}).expect(201);
    await api().post(`/api/invites/${inv.body.code}`).set(auth(spammer)).expect(200);
    const channel = s.body.channels.find((c: any) => c.type === 'text').id;
    config.rateLimits = true;
    resetStrikes();
    const { pool } = await import('../src/db.js');
    try {
      const send = () => api().post(`/api/channels/${channel}/messages`).set(auth(spammer)).send({ content: 'compre já' });
      for (let i = 0; i < 3; i++) await send().expect(201);
      await send().expect(429);
      // Two more strikes (the 15 s gap between strikes is skipped by clearing it).
      for (let i = 0; i < 2; i++) { resetStrikes(); await send().expect(429); }
      const muted = await send().expect(403);
      expect(muted.body.code).toBe('muted');
      expect((await api().get('/api/users/@me').set(auth(spammer))).body.mutedUntil).toBeTruthy();
      const log = await api().get(`/api/servers/${s.body.id}/spam-log`).set(auth(owner)).expect(200);
      expect(log.body.map((l: any) => l.kind)).toContain('mute');
      expect(log.body[0].user.id).toBe(spammer.id);
      await api().get(`/api/servers/${s.body.id}/spam-log`).set(auth(spammer)).expect(403);
    } finally {
      config.rateLimits = false;
      await pool.query('UPDATE users SET muted_until = NULL WHERE id = $1', [spammer.id]);
    }
  });

  it('takes reports and lets the admin suspend an account', async () => {
    const bad = await register('golpista');
    const sock = await connect(bad);
    await api().post('/api/reports').set(auth(bia)).send({ targetId: bad.id, reason: 'scam', details: 'pediu pix' }).expect(201);
    await api().post('/api/reports').set(auth(bia)).send({ targetId: bia.id, reason: 'spam' }).expect(400);
    // Only the admin (the first account) sees reports.
    await api().get('/api/admin/reports').set(auth(bia)).expect(403);
    expect((await api().get('/api/users/@me').set(auth(ana))).body.isAdmin).toBe(true);
    const list = await api().get('/api/admin/reports').set(auth(ana)).expect(200);
    const rep = list.body.find((r: any) => r.target.id === bad.id);
    expect(rep).toMatchObject({ reason: 'scam', details: 'pediu pix', status: 'open' });
    const kicked = nextEvent(sock, 'disconnect');
    await api().post(`/api/admin/users/${bad.id}/ban`).set(auth(ana)).send({ reason: 'golpe' }).expect(200);
    await kicked;
    expect((await api().get('/api/servers').set(auth(bad)).expect(403)).body.code).toBe('banned');
    expect((await api().post('/api/auth/login').send({ username: 'golpista', password: 'senha-forte-123' }).expect(403)).body.error).toMatch(/suspensa: golpe/);
    await api().post(`/api/admin/reports/${rep.id}`).set(auth(ana)).send({ status: 'actioned' }).expect(200);
    expect((await api().get('/api/admin/reports').set(auth(ana))).body.find((r: any) => r.id === rep.id)).toBeUndefined();
    await api().post(`/api/admin/users/${ana.id}/ban`).set(auth(ana)).send({}).expect(400);
    await api().delete(`/api/admin/users/${bad.id}/ban`).set(auth(ana)).expect(200);
    await api().get('/api/servers').set(auth(bad)).expect(200);
  });

  it('counts wrong passwords and raises an alert at 10', async () => {
    const { pool } = await import('../src/db.js');
    await register('alvo');
    for (let i = 0; i < 10; i++) await api().post('/api/auth/login').send({ username: 'alvo', password: 'errada-errada' }).expect(401);
    const { rows } = await pool.query("SELECT failed_logins, login_alert_at FROM users WHERE username = 'alvo'");
    expect(rows[0].failed_logins).toBe(10);
    expect(rows[0].login_alert_at).toBeTruthy();
    await api().post('/api/auth/login').send({ username: 'alvo', password: 'senha-forte-123' }).expect(200);
    expect((await pool.query("SELECT failed_logins FROM users WHERE username = 'alvo'")).rows[0].failed_logins).toBe(0);
  });
});
