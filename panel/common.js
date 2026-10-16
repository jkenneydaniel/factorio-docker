import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(condition, message, status = 400) { if (!condition) throw new HttpError(status, message); }
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function writeJSON(file, data) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = `${file}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), {mode:0o600});
  await fs.rename(temp, file);
}
export function json(res, status, data, headers = {}) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers});
  res.end(JSON.stringify(data));
}
export async function readBody(req, limit = 1024 * 1024) {
  assert(Number(req.headers['content-length'] || 0) <= limit, 'Request is too large.', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; assert(size <= limit, 'Request is too large.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function requestJSON(req) {
  try { return JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON request.'); }
}
export function safeName(input) {
  const value = String(input || '').trim();
  assert(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/.test(value) && !value.includes('..'), 'Use a name of 1–80 letters, numbers, spaces, dots, or dashes.');
  return value.replace(/\.zip$/i, '');
}
export function inside(root, relative) {
  assert(typeof relative === 'string' && !relative.includes('\0') && !relative.includes('\\'), 'Invalid file path.');
  const target = path.resolve(root, relative);
  assert(target.startsWith(path.resolve(root) + path.sep), 'File path is outside the allowed directory.');
  return target;
}
export async function existingFile(root, relative) {
  const target = inside(root, relative);
  let real;
  try { real = await fs.realpath(target); } catch { throw new HttpError(404, 'File not found.'); }
  assert(real.startsWith((await fs.realpath(root)) + path.sep), 'Symbolic links outside the data directory are not allowed.');
  assert((await fs.stat(real)).isFile(), 'Expected a file.');
  return real;
}
export function equalSecret(a, b) {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function redact(text) {
  return String(text).split('\n').filter(line => !/^\s*\+/.test(line) && !/rcon-password|rconpw|"token"|auth.*key/i.test(line)).join('\n');
}
