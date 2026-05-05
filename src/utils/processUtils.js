const { execFileSync } = require('child_process');
const logger = require('./logger');
const { safePid } = require('./validation');

function killProcessTree(pid) {
    let safe;
    try {
        safe = safePid(pid, 'pid');
    } catch (e) {
        logger.warn(`killProcessTree refused invalid pid: ${pid}`);
        return;
    }
    try {
        if (process.platform === 'win32') {
            // execFileSync bypasses cmd.exe entirely — no shell metacharacter risk.
            execFileSync('taskkill', ['/F', '/T', '/PID', safe], { stdio: 'ignore', windowsHide: true });
        } else {
            process.kill(-parseInt(safe, 10), 'SIGKILL');
        }
        logger.info(`Killed process tree for PID ${safe}`);
    } catch (err) {
        logger.warn(`Failed to kill process tree for PID ${safe}: ${err.message}`);
    }
}

// Strip common ANSI CSI sequences (colour codes, cursor moves). Not exhaustive
// but covers what Minecraft / Java / Paper write to stdout in practice.
function stripAnsi(str) {
    // CSI sequences: ESC [ ... (letter in @-~)
    // OSC sequences: ESC ] ... (terminated by BEL or ESC\)
    return String(str)
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
}

// Make a console/log line safe to broadcast and persist: strip ANSI, strip
// remaining control characters (except \t), cap length so a malicious plugin
// can't OOM the panel by spamming 1MB lines.
const MAX_LINE_LENGTH = 4096;
function sanitizeConsoleLine(line) {
    let s = stripAnsi(String(line));
    // Strip C0 controls except tab; strip C1 controls (0x80-0x9F).
    s = s.replace(/[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g, '');
    if (s.length > MAX_LINE_LENGTH) {
        s = s.slice(0, MAX_LINE_LENGTH) + '…[truncated]';
    }
    return s;
}

module.exports = { killProcessTree, stripAnsi, sanitizeConsoleLine };
