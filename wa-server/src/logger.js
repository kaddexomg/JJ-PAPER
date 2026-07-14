import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
  }
});

// Logger silencioso para Baileys (es MUY ruidoso en trace/debug)
export const baileysLogger = pino({ level: 'silent' });
