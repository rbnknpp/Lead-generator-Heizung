const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors());
app.use(express.json());

app.use((req, res, next) => { res.setTimeout(60000); next(); });

app.get("/", (req, res) => {
  res.json({ status: "ok", key_loaded: !!process.env.GOOGLE_API_KEY, version: "3.0-email-scraper" });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// E-Mail aus Webseite extrahieren
async function scrapeEmail(websiteUrl) {
  if (!websiteUrl || websiteUrl === "–") return null;

  // Sicherstellen dass URL mit http beginnt
  let url = websiteUrl;
  if (!url.startsWith("http")) url = "https://" + url;

  const pagesToTry = [
    url,
    url.replace(/\/$/, "") + "/impressum",
    url.replace(/\/$/, "") + "/kontakt",
    url.replace(/\/$/, "") + "/contact",
    url.replace(/\/$/, "") + "/ueber-uns",
  ];

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const excludeDomains = ["sentry.io", "wixpress.com", "example.com", "googleapis.com", "schema.org", "w3.org", "jquery.com"];

  for (const pageUrl of pagesToTry) {
    try {
      const res = await fetch(pageUrl, {
        timeout: 6000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadFinder/1.0)" }
      });
      if (!res.ok) continue;

      const html = await res.text();
      // Auch mailto: Links finden
      const mailtoMatches = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g) || [];
      const emailMatches = html.match(emailRegex) || [];

      const allEmails = [
        ...mailtoMatches.map(m => m.replace("mailto:", "")),
        ...emailMatches
      ].filter(e => !excludeDomains.some(d => e.includes(d)))
       .filter(e => !e.includes(".png") && !e.includes(".jpg") && !e.includes(".css") && !e.includes(".js"))
       .filter(e => e.length < 60);

      if (allEmails.length > 0) {
        // Bevorzuge info@, kontakt@, mail@ etc.
        const preferred = allEmails.find(e => 
          e.startsWith("info@") || e.startsWith("kontakt@") || 
          e.startsWith("mail@") || e.startsWith("office@") ||
          e.startsWith("anfrage@") || e.startsWith("service@")
        );
        return preferred || allEmails[0];
      }
    } catch (e) {
      // Seite nicht erreichbar, nächste versuchen
    }
  }
  return null;
}

// Hauptsuche mit automatischem E-Mail Scraping
app.post("/places/search", async (req, res) => {
  const API_KEY = process.env.GOOGLE_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "GOOGLE_API_KEY nicht gesetzt" });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query fehlt" });

  try {
    let allResults = [];

    // Seite 1
    const firstUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}&language=de&region=de`;
    const firstData = await (await fetch(firstUrl)).json();

    if (firstData.status === "REQUEST_DENIED") {
      return res.status(403).json({ error: "API Key ungültig", message: firstData.error_message });
    }

    allResults = allResults.concat(firstData.results || []);
    console.log(`Seite 1: ${firstData.results?.length} Ergebnisse`);

    // Seite 2
    if (firstData.next_page_token) {
      await sleep(2000);
      const page2Data = await (await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${firstData.next_page_token}&key=${API_KEY}`)).json();
      if (page2Data.status === "OK") {
        allResults = allResults.concat(page2Data.results || []);
        console.log(`Seite 2: ${page2Data.results?.length} Ergebnisse`);

        // Seite 3
        if (page2Data.next_page_token) {
          await sleep(2000);
          const page3Data = await (await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${page2Data.next_page_token}&key=${API_KEY}`)).json();
          if (page3Data.status === "OK") {
            allResults = allResults.concat(page3Data.results || []);
            console.log(`Seite 3: ${page3Data.results?.length} Ergebnisse`);
          }
        }
      }
    }

    console.log(`Gesamt: ${allResults.length} Betriebe — lade Details + E-Mails...`);

    // Details + E-Mails für alle Betriebe laden
    const enriched = await Promise.all(allResults.map(async (place) => {
      try {
        // Details von Google (Webseite + Telefon)
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website&key=${API_KEY}`;
        const detailData = await (await fetch(detailUrl)).json();
        const details = detailData.result || {};

        const website = details.website || null;
        const phone = details.formatted_phone_number || null;

        // E-Mail von Webseite scrapen
        let email = null;
        if (website) {
          email = await scrapeEmail(website);
        }

        return {
          ...place,
          website: website || null,
          phone: phone || null,
          email: email || null,
        };
      } catch (e) {
        return { ...place, website: null, phone: null, email: null };
      }
    }));

    const withEmail = enriched.filter(r => r.email).length;
    console.log(`Fertig: ${withEmail}/${enriched.length} E-Mails gefunden`);

    res.json({ status: "OK", results: enriched, total: enriched.length, emails_found: withEmail });

  } catch (err) {
    console.error("Fehler:", err.message);
    res.status(500).json({ error: "Fehler", details: err.message });
  }
});

app.get("/places/details", async (req, res) => {
  const API_KEY = process.env.GOOGLE_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "GOOGLE_API_KEY nicht gesetzt" });
  const { place_id } = req.query;
  if (!place_id) return res.status(400).json({ error: "place_id fehlt" });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=name,formatted_phone_number,website,formatted_address&key=${API_KEY}&language=de`;
  try {
    const data = await (await fetch(url)).json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Fehler", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server v3.0 läuft auf Port ${PORT}`);
  console.log(`GOOGLE_API_KEY: ${!!process.env.GOOGLE_API_KEY}`);
});
