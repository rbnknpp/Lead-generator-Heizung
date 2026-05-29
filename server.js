const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.options("*", cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", key_loaded: !!process.env.GOOGLE_API_KEY });
});

// Hilfsfunktion: eine Seite von Google holen
async function fetchPage(url) {
  const res = await fetch(url);
  return res.json();
}

// Wartezeit zwischen Seiten (Google braucht ~2s)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Hauptendpoint: holt automatisch bis zu 60 Ergebnisse (3 Seiten)
app.post("/places/search", async (req, res) => {
  const API_KEY = process.env.GOOGLE_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "GOOGLE_API_KEY nicht gesetzt" });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query fehlt" });

  try {
    let allResults = [];
    let nextPageToken = null;
    let page = 0;

    // Erste Seite
    const firstUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}&language=de&region=de`;
    const firstData = await fetchPage(firstUrl);

    if (firstData.status === "REQUEST_DENIED") {
      return res.status(403).json({ error: "API Key ungültig", message: firstData.error_message });
    }

    allResults = allResults.concat(firstData.results || []);
    nextPageToken = firstData.next_page_token || null;
    page++;

    // Seite 2 und 3
    while (nextPageToken && page < 3) {
      await sleep(2500); // Google braucht Zeit bis Token aktiv ist
      const nextUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPageToken}&key=${API_KEY}`;
      const nextData = await fetchPage(nextUrl);

      if (nextData.status === "OK" || nextData.status === "ZERO_RESULTS") {
        allResults = allResults.concat(nextData.results || []);
        nextPageToken = nextData.next_page_token || null;
      } else {
        // Bei INVALID_REQUEST aufhören
        break;
      }
      page++;
    }

    res.json({
      status: "OK",
      results: allResults,
      total: allResults.length,
      pages_fetched: page
    });

  } catch (err) {
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
  console.log(`Server läuft auf Port ${PORT}`);
  console.log(`GOOGLE_API_KEY gesetzt: ${!!process.env.GOOGLE_API_KEY}`);
});
