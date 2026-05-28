const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GOOGLE_API_KEY; // wird in Railway als Umgebungsvariable gesetzt

app.use(cors()); // erlaubt Anfragen von überall (auch vom Claude-Tool)
app.use(express.json());

// Health Check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "LeadFinder Proxy läuft ✓" });
});

// Google Places Text Search
app.get("/places/search", async (req, res) => {
  const { query, pagetoken } = req.query;

  if (!API_KEY) {
    return res.status(500).json({ error: "GOOGLE_API_KEY nicht gesetzt" });
  }

  let url;
  if (pagetoken) {
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${pagetoken}&key=${API_KEY}`;
  } else {
    if (!query) return res.status(400).json({ error: "query fehlt" });
    url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}&language=de&region=de`;
  }

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Google API Fehler", details: err.message });
  }
});

// Google Place Details (für Telefon + Webseite)
app.get("/places/details", async (req, res) => {
  const { place_id } = req.query;

  if (!place_id) return res.status(400).json({ error: "place_id fehlt" });

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=name,formatted_phone_number,website,formatted_address&key=${API_KEY}&language=de`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Google API Fehler", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✓ Proxy läuft auf Port ${PORT}`);
});
