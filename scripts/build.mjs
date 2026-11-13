import { readdirSync, readFileSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const directory of ['src','public','scripts','tests']) {
  for (const file of readdirSync(directory).filter(name => /\.(?:mjs|js)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', resolve(directory, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
  }
}
console.log('JavaScript syntax verified.');
if (!process.argv.includes('--check')) {
  rmSync('dist', { recursive: true, force: true });
  mkdirSync('dist', { mode: 0o755 });
  for (const path of ['src','public','data','migrations','package.json','LICENSE','README.md','docs','Dockerfile','.dockerignore','.gitignore','scripts','tests']) {
    cpSync(path, resolve('dist', path), { recursive: true });
  }
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  writeFileSync('dist/BUILD.txt', `AstroByte Health Monitor ${version}\nNode.js 24+\nRun npm start in this directory.\n`);
  console.log('Production release assembled in dist/.');
}
