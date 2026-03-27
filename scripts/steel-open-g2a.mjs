import dotenv from "dotenv";
import Steel from "steel-sdk";
import { chromium } from "playwright";

dotenv.config();

const apiKey = process.env.STEEL_API_KEY || process.env.STEEP_API_KEY;

if (!apiKey) {
  throw new Error("Aucune cle API Steel trouvee (STEEL_API_KEY/STEEP_API_KEY).");
}

const client = new Steel({
  steelAPIKey: apiKey,
});

const session = await client.sessions.create({
  timeout: 900_000,
});

console.log(`SESSION_ID=${session.id}`);
console.log(`SESSION_VIEWER_URL=${session.sessionViewerUrl}`);

const browser = await chromium.connectOverCDP(
  `wss://connect.steel.dev?apiKey=${apiKey}&sessionId=${session.id}`,
);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = await context.newPage();

await page.goto("https://www.g2a.com", { waitUntil: "domcontentloaded" });
console.log("NAVIGATED_TO=https://www.g2a.com");

// Garde le process et la session ouverts jusqu'a interruption manuelle.
await new Promise(() => {});
