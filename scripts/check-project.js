'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const required = [
  'package.json','src/main/main.js','src/main/ipc.js','src/main/download-manager.js','src/main/browser-manager.js',
  'src/main/browser-session-manager.js','src/preload/preload.js','src/preload/browser-preload.js','src/browser/index.html',
  'src/browser/browser.js','src/browser/styles.css','src/renderer/index.html','src/renderer/renderer.js','src/renderer/styles.css',
  'scripts/setup-binaries.js','scripts/ensure-node.ps1','scripts/ensure-dependencies.ps1','REPAIR_AND_RUN.bat','RUN.bat',
  'BUILD_INSTALLER.bat','build/icon.ico'
];
let failed=false;
for(const relative of required){if(!fs.existsSync(path.join(root,relative))){console.error(`Missing required file: ${relative}`);failed=true}}
const jsFiles=[];
for(const base of ['src','scripts','tests']){
  const initial=path.join(root,base);if(!fs.existsSync(initial))continue;const stack=[initial];
  while(stack.length){const current=stack.pop();for(const entry of fs.readdirSync(current,{withFileTypes:true})){
    const full=path.join(current,entry.name);if(entry.isDirectory())stack.push(full);else if(entry.name.endsWith('.js'))jsFiles.push(full)
  }}
}
for(const file of jsFiles){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){console.error(r.stderr||r.stdout);failed=true}}
const packageJsonText=fs.readFileSync(path.join(root,'package.json'),'utf8');
if(/artifactory\/api\/npm|registry\.company|npm\.internal/i.test(packageJsonText)){console.error('package.json contains a private registry URL.');failed=true}
const packageJson=JSON.parse(packageJsonText);
if(!packageJson.build?.appId||!packageJson.build?.nsis){console.error('electron-builder configuration is incomplete.');failed=true}
if(packageJson.allowScripts?.['electron@43.1.1']!==true){console.error('Electron install script is not explicitly reviewed in allowScripts.');failed=true}
const ensureNodeText=fs.readFileSync(path.join(root,'scripts/ensure-node.ps1'),'utf8');
if(!ensureNodeText.includes('$NodeVersion = "22.23.1"')){console.error('Unexpected local Node.js bootstrap version.');failed=true}
const ensureDependenciesText=fs.readFileSync(path.join(root,'scripts/ensure-dependencies.ps1'),'utf8');
for(const token of ['Install-ElectronRuntimeDirect','SHASUMS256.txt','electron-v$version-win32-x64.zip','Clear-ElectronEnvironment']){
  if(!ensureDependenciesText.includes(token)){console.error(`Missing Electron direct-install safeguard: ${token}`);failed=true}
}
if(failed)process.exit(1);console.log(`Project check passed. Checked ${jsFiles.length} JavaScript files.`);
