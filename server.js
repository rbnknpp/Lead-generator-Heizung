const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors());
app.use(express.json());

// Increase timeout to 30 seconds
app.use((req, res, next) => {
  res.setTimeout(30000);
  next();
});

app.get("/", (req, res) => {
  res.json({ status: "ok", key_loaded: !!process.env.GOOGLE_API_KEY, version: "2.0-pagination" });
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.post("/places/search", async (req, res) => {
  const API_KEY = process.env.GOOGLE_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "GOOGLE_API_KEY nicht gesetzt" });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query fehlt" });

  try {
    let allResults = [];

    // Seite 1
    const firstUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}&language=de&region=de`;
    const firstRes = await fetch(firstUrl);
    const firstData = await firstRes.json();

    if (firstData.status === "REQUEST_DENIED") {
      return res.status(403).json({ error: "API Key ungültig", message: firstData.error_message });
    }

    allResults = allResults.concat(firstData.results || []);
    console.log(`Seite 1: ${firstData.results?.length} Ergebnisse, Token: ${firstData.next_page_token ? 'ja' : 'nein'}`);

    // Seite 2
    if (firstData.next_page_token) {
      await sleep(2000);
      const page2Url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${firstData.next_page_token}&key=${API_KEY}`;
      const page2Res = await fetch(page2Url);
      const page2Data = await page2Res.json();
      console.log(`Seite 2 Status: ${page2Data.status}, Ergebnisse: ${page2Data.results?.length}`);

      if (page2Data.status === "OK") {
        allResults = allResults.concat(page2Data.results || []);

        // Seite 3
        if (page2Data.next_page_token) {
          await sleep(2000);
          const page3Url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${page2Data.next_page_token}&key=${API_KEY}`;
          const page3Res = await fetch(page3Url);
          const page3Data = await page3Res.json();
          console.log(`Seite 3 Status: ${page3Data.status}, Ergebnisse: ${page3Data.results?.length}`);

          if (page3Data.status === "OK") {
            allResults = allResults.concat(page3Data.results || []);
          }
        }
      }
    }

    console.log(`Gesamt: ${allResults.length} Ergebnisse für "${query}"`);
    res.json({ status: "OK", results: allResults, total: allResults.length });

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
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Fehler", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server v2.0 läuft auf Port ${PORT}`);
  console.log(`GOOGLE_API_KEY gesetzt: ${!!process.env.GOOGLE_API_KEY}`);
});
