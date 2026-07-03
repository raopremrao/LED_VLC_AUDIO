import { CONFIG } from './config.js';

export class Logger {
    static log(level, context, message) {
        if (level < CONFIG.LOGGING.CURRENT_LEVEL) return;

        const time = new Date().toLocaleTimeString();
        let color = '#e9edef';
        let prefix = '[INFO]';
        
        switch(level) {
            case CONFIG.LOGGING.LEVELS.DEBUG:
                color = '#8696a0';
                prefix = '[DEBUG]';
                break;
            case CONFIG.LOGGING.LEVELS.INFO:
                color = '#00a884';
                prefix = '[INFO]';
                break;
            case CONFIG.LOGGING.LEVELS.WARN:
                color = '#ffeb3b';
                prefix = '[WARN]';
                break;
            case CONFIG.LOGGING.LEVELS.ERROR:
                color = '#ef9a9a';
                prefix = '[ERROR]';
                break;
        }

        const formattedMsg = `<div><span style="color:#555">[${time}]</span> <span style="color:#aaa">${prefix} [${context}]</span> <span style="color:${color}">${message}</span></div>`;
        
        const consoleEl = document.getElementById(`console`);
        if (consoleEl) {
            consoleEl.innerHTML += formattedMsg;
            // Only auto-scroll if we are near the bottom to allow user to read history
            if (consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 50) {
                consoleEl.scrollTop = consoleEl.scrollHeight;
            }
        }
        
        console.log(`${prefix} [${context}] ${message}`);
    }

    static debug(context, message) { this.log(CONFIG.LOGGING.LEVELS.DEBUG, context, message); }
    static info(context, message) { this.log(CONFIG.LOGGING.LEVELS.INFO, context, message); }
    static warn(context, message) { this.log(CONFIG.LOGGING.LEVELS.WARN, context, message); }
    static error(context, message) { this.log(CONFIG.LOGGING.LEVELS.ERROR, context, message); }
    
    static clear() {
        const consoleEl = document.getElementById(`console`);
        if (consoleEl) {
            consoleEl.innerHTML = '';
        }
    }
}
