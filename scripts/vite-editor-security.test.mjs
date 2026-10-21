import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const bundle = readFileSync(path.join(path.dirname(require.resolve('vite/package.json')), 'dist/node/chunks/node.js'), 'utf8');

// Execute the installed implementation, never a reimplementation of its sanitizers.
function region(file) {
  const matches = [...bundle.matchAll(/^\/\/#region .*\/node_modules\/launch-editor\/([^\r\n]+)\r?$/gm)]
    .filter(match => match[1] === file);
  if (matches.length !== 1) throw Error(`Expected one bundled launch-editor region: ${file}`);
  const start = matches[0].index;
  const end = bundle.indexOf('//#endregion', start);
  if (end < 0) throw Error(`Missing region end: ${file}`);
  return bundle.slice(start, end);
}

function harness({ platform = 'win32', exists = () => true } = {}) {
  const calls = [], checked = [], errors = [];
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const cwd = platform === 'win32' ? 'C:\\fixture' : '/mnt/c/fixture';
  const fakePath = { ...paths, resolve: (...args) => paths.resolve(cwd, ...args),
    relative: (from, to) => paths.relative(from || cwd, to) };
  const record = kind => (...args) => {
    calls.push({ kind, args });
    const child = new EventEmitter();
    child.kill = () => { throw Error('Unexpected child kill'); };
    return child;
  };
  const deny = name => { throw Error(`Unexpected module/member: ${name}`); };
  const strict = (name, members) => new Proxy(members, {
    get(target, key) { return Object.hasOwn(target, key) ? target[key] : deny(`${name}.${String(key)}`); },
  });
  const modules = {
    fs: strict('fs', { existsSync(file) { checked.push(file); return exists(file); } }),
    path: strict('path', fakePath),
    os: strict('os', { release: () => '5.15.0-Microsoft' }),
    child_process: strict('child_process', { exec: record('exec'), spawn: record('spawn') }),
  };
  const context = vm.createContext({
    process: strict('process', { platform, env: {}, cwd: () => cwd }),
    console: { log() {} },
    __require(name) { return Object.hasOwn(modules, name) ? modules[name] : deny(name); },
    __commonJSMin(factory) { let cachedModule; return () => {
      if (!cachedModule) { cachedModule = { exports: {} }; factory(cachedModule.exports, cachedModule); }
      return cachedModule.exports;
    }; },
    require_picocolors: () => ({ red: value => value }),
    require_guess: () => editor => [editor],
  }, { codeGeneration: { strings: false, wasm: false } });
  const files = ['get-args.js', 'construct-windows-launch-command.js', 'parse-file.js', 'index.js'];
  const launch = vm.runInContext(files.map(region).join('\n') + '\nrequire_launch_editor();', context, { timeout: 1000 });
  return { calls, checked, errors, launch(file, editor = 'code.cmd') {
    launch(file, editor, (_file, error) => errors.push(error));
  } };
}

test.each(['%', '%SAFE_MARKER%', '\r', '\n'])('GHSA-698v rejects Windows shell expansion/separator %j before execution', marker => {
  const h = harness();
  h.launch(`C:\\fixture\\name${marker}.ts`);
  expect(h.calls).toEqual([]);
  expect(h.errors).toHaveLength(1);
  expect(h.errors[0]).toMatch(/Cannot launch an editor/);
});

test.each(['+SAFE_MARKER', '-SAFE_MARKER'])('GHSA-r825 protects WSL editor filename operand %s', file => {
  const h = harness({ platform: 'linux' });
  h.launch(`/mnt/c/fixture/${file}:12:3`, 'vim');
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].kind).toBe('spawn');
  expect(Array.from(h.calls[0].args[1])).toEqual(['+call cursor(12, 3)', `./${file}`]);
  expect(h.errors).toEqual([]);
});

test.each(['NONEXISTENT', '%SAFE_MARKER%'])('GHSA-587h canonicalizes post-position path before existence check: %s', component => {
  const h = harness({ exists: file => file === 'C:\\fixture' || file.endsWith('\\..') });
  h.launch(`C:\\fixture\\${component}\\..:1:1`);
  expect(h.checked).toEqual(['C:\\fixture']);
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].kind).toBe('exec');
  expect(h.calls[0].args[0]).toContain('C:\\fixture:1:1');
  expect(h.calls[0].args[0]).not.toContain(component);
  expect(h.calls[0].args[0]).not.toContain('\\..');
});

test('legitimate Windows spaces and framework route punctuation retain editor position', () => {
  const h = harness();
  h.launch('C:\\fixture\\route space\\[slug]\\+page.ts:12:3');
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].kind).toBe('exec');
  expect(h.calls[0].args[0]).toBe('code.cmd -r -g "C:\\fixture\\route space\\[slug]\\+page.ts:12:3"');
  expect(h.errors).toEqual([]);
});

test('legitimate Linux filename is passed as a single operand', () => {
  const h = harness({ platform: 'linux' });
  h.launch('/home/fixture/route space.ts', 'code');
  expect(h.calls).toHaveLength(1);
  expect(h.calls[0].kind).toBe('spawn');
  expect(Array.from(h.calls[0].args[1])).toEqual(['/home/fixture/route space.ts']);
});

test('missing file never executes an editor', () => {
  const h = harness({ exists: () => false });
  h.launch('C:\\fixture\\missing.ts');
  expect(h.calls).toEqual([]);
  expect(h.errors).toEqual([]);
});
