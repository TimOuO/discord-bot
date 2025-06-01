import { ExtendedClient } from '../structures/ExtendedClient';
import fs from 'fs';
import path from 'path';

export function registerEvents(client: ExtendedClient): void {
  const eventsPath = path.join(__dirname);
  const eventFiles = fs.readdirSync(eventsPath).filter(file => 
    file !== 'index.ts' && (file.endsWith('.ts') || file.endsWith('.js'))
  );

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath).default;
    
    if (typeof event === 'function') {
      event(client);
    }
  }
}