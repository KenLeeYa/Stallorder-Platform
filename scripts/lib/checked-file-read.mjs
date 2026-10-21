import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';

const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');

// The type, limit and bytes are observed through the same descriptor.
export function readCheckedFile(path, { expected, maxBytes = Infinity } = {}, io = { openSync, fstatSync, readFileSync, closeSync }) {
 const fd = io.openSync(path, 'r');
 try {
  const before = io.fstatSync(fd);
  if (expected && identity(before) !== identity(expected)) throw Error('FILE_READ_IDENTITY_CHANGED');
  if (!before.isFile() || before.size > maxBytes) return null;
  const bytes = io.readFileSync(fd);
  const after = io.fstatSync(fd);
  if (identity(before) !== identity(after) || bytes.length !== before.size) throw Error('FILE_READ_CHANGED');
  return bytes;
 } finally { io.closeSync(fd); }
}
