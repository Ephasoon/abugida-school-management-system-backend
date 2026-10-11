// npm entry point: runs tests/regress.sh with Git Bash.
// npm on Windows uses cmd.exe, where a plain `bash` is usually WSL's bash,
// which cannot run these scripts. Override with GIT_BASH=<path to bash.exe>.
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const findBash = () => {
  if (process.env.GIT_BASH) return process.env.GIT_BASH;
  try {
    // <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe
    const exec = execSync('git --exec-path', { encoding: 'utf8' }).trim();
    const bash = path.resolve(exec, '..', '..', '..', 'bin', 'bash.exe');
    if (fs.existsSync(bash)) return bash;
  } catch { /* fall through */ }
  return 'C:/Program Files/Git/bin/bash.exe';
};

const bash = findBash();
if (!fs.existsSync(bash)) {
  console.error(`Git Bash not found (${bash}). Set GIT_BASH to its bash.exe.`);
  process.exit(1);
}
const r = spawnSync(bash, [path.join(__dirname, 'regress.sh'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
