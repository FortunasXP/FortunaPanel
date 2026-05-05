const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/default');

const logsDir = path.resolve(process.env.LOGS_DIR || './logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}

const logger = winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] ${level}: ${message}`;
                })
            )
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'panel.log'),
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3
        })
    ]
});

module.exports = logger;
