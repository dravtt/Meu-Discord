import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { initRealtime } from '../src/realtime.js';

export let http: Server;
export let baseUrl: string;

export async function startServer() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  http = createServer(createApp());
  initRealtime(http);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  baseUrl = `http://localhost:${(http.address() as AddressInfo).port}`;
}

export async function stopServer() {
  await new Promise((resolve) => http.close(resolve));
  await pool.end();
}

export const api = () => request(http);

export interface TestUser { id: string; token: string; username: string }

export async function register(username: string): Promise<TestUser> {
  const res = await api().post('/api/auth/register').send({ username, password: 'senha-forte-123' }).expect(201);
  return { id: res.body.user.id, token: res.body.token, username };
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

export function connect(u: TestUser): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { auth: { token: u.token }, transports: ['websocket'], forceNew: true });
    socket.once('ready', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

export function nextEvent<T = any>(socket: Socket, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload); });
  });
}

/** Resolves true if the event does NOT arrive within the window. */
export function noEvent(socket: Socket, event: string, window = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { socket.off(event, handler); resolve(true); }, window);
    socket.once(event, handler);
  });
}
