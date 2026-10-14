type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const PREFIX = '[sublens]'

function log(level: LogLevel, tag: string, message: string, ...args: unknown[]): void {
  const prefix = `${PREFIX} [${tag}]`
  switch (level) {
    case 'error':
      console.error(prefix, message, ...args)
      break
    case 'warn':
      console.warn(prefix, message, ...args)
      break
    case 'info':
      console.info(prefix, message, ...args)
      break
    case 'debug':
      console.debug(prefix, message, ...args)
      break
  }
}

export const logger = {
  error: (tag: string, message: string, ...args: unknown[]) => log('error', tag, message, ...args),
  warn:  (tag: string, message: string, ...args: unknown[]) => log('warn',  tag, message, ...args),
  info:  (tag: string, message: string, ...args: unknown[]) => log('info',  tag, message, ...args),
  debug: (tag: string, message: string, ...args: unknown[]) => log('debug', tag, message, ...args),
}
