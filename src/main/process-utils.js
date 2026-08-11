'use strict';

const { spawn, execFile } = require('node:child_process');

function spawnCaptured(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      ...options
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

function killProcessTree(child) {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
  } else {
    try { child.kill('SIGTERM'); } catch {}
  }
}

module.exports = { spawnCaptured, killProcessTree };
