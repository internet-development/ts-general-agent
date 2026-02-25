//NOTE(self): Discovery chain for ts-agent-space servers.
//NOTE(self): Priority: SPACE_URL env var → mDNS → localhost default.

import Bonjour from 'bonjour-service';

const MDNS_SERVICE_TYPE = 'agent-space';
const DISCOVERY_TIMEOUT_MS = 10_000;
const DEFAULT_SPACE_URL = 'ws://localhost:7777';

//NOTE(self): Discover a space server — env var first, then mDNS, then localhost default
export async function discoverSpace(): Promise<string | null> {
  //NOTE(self): Manual override takes highest precedence
  const envUrl = process.env.SPACE_URL;
  if (envUrl) {
    return envUrl;
  }

  //NOTE(self): Try mDNS discovery
  const mdnsUrl = await discoverViaMdns();
  if (mdnsUrl) {
    return mdnsUrl;
  }

  //NOTE(self): Fall back to localhost default — covers the common local dev case
  return DEFAULT_SPACE_URL;
}

//NOTE(self): mDNS discovery with timeout — returns null if no service found
function discoverViaMdns(): Promise<string | null> {
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
