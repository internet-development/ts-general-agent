//NOTE(self): mDNS Browser for discovering ts-agent-space servers on the local network.
//NOTE(self): Falls back to SPACE_URL env var for manual override.

import Bonjour from 'bonjour-service';

const MDNS_SERVICE_TYPE = 'agent-space';
const DISCOVERY_TIMEOUT_MS = 10_000;

//NOTE(self): Discover a space server via mDNS or env var fallback
export async function discoverSpace(): Promise<string | null> {
  //NOTE(self): Manual override takes precedence
  const envUrl = process.env.SPACE_URL;
  if (envUrl) {
    return envUrl;
  }

  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    let resolved = false;

    const browser = bonjour.find({ type: MDNS_SERVICE_TYPE });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        browser.stop();
        bonjour.destroy();
        resolve(null);
      }
    }, DISCOVERY_TIMEOUT_MS);

    browser.on('up', (service) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      //NOTE(self): Build WebSocket URL from discovered service
      const host = service.host || 'localhost';
      const port = service.port;
      const url = `ws://${host}:${port}`;

      browser.stop();
      bonjour.destroy();
      resolve(url);
    });
  });
}
