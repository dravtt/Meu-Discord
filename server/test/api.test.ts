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
    await api().post('/api/auth/register').send({ username: 'ANA', password: 'outra-senha-1' }).expect(409);
    await api().post('/api/auth/login').send({ username: 'ana', password: 'errada-errada' }).expect(401);
    const ok = await api().post('/api/auth/login').send({ username: 'ana', password: 'senha-forte-123' }).expect(200);
    expect(ok.body.user.username).toBe('ana');
  });

  it('requires a token and updates the profile', async () => {
    await api().get('/api/users/@me').expect(401);
    const res = await api().patch('/api/users/@me').set(auth(ana)).send({ displayName: 'Ana', customStatus: 'codando' }).expect(200);
    expect(res.body).toMatchObject({ displayName: 'Ana', customStatus: 'codando' });
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

  it('keeps private notes and the server order', async () => {
    await api().put(`/api/users/${bia.id}/note`).set(auth(ana)).send({ note: 'amiga da escola' }).expect(200);
    expect((await api().get(`/api/users/${bia.id}`).set(auth(ana)).expect(200)).body.note).toBe('amiga da escola');
    expect((await api().get(`/api/users/${bia.id}`).set(auth(caio)).expect(200)).body.note).toBe('');
    await api().put('/api/users/@me/server-order').set(auth(ana)).send({ serverIds: [serverId] }).expect(204);
    expect((await api().get('/api/users/@me').set(auth(ana)).expect(200)).body.serverOrder).toEqual([serverId]);
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
