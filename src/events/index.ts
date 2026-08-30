import { ExtendedClient } from '../structures/ExtendedClient';
import fs from 'fs';
import path from 'path';

function isLoadableModule(file: string): boolean {
  if (file.endsWith('.d.ts') || file.endsWith('.map')) return false;
  const ext = path.extname(file);
  if (ext !== '.ts' && ext !== '.js') return false;
  return path.basename(file, ext) !== 'index';
}

export function registerEvents(client: ExtendedClient): void {
  const eventsPath = path.join(__dirname);
  const eventFiles = fs.readdirSync(eventsPath).filter(isLoadableModule);

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath).default;
    
    if (typeof event === 'function') {
      event(client);
    }
  }
}