/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import * as esbuild from "esbuild";
import AdmZip from "adm-zip";
import dotenv from "dotenv";

dotenv.config();

// Inizializzazione pigra (lazy initialization) del client Gemini per evitare crash all'avvio se manca la chiave
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // --- METADATI PWA (MANIFEST.JSON, SERVICE WORKER E ICONE COMPRESE) ---
  app.get("/manifest.json", (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send({
      "name": "Flora — Botanical Archive",
      "short_name": "Flora",
      "description": "Archivio botanico interattivo e custode della tua serra digitale offline e in tempo reale.",
      "start_url": "/",
      "display": "standalone",
      "background_color": "#fbfbf9",
      "theme_color": "#2d3a27",
      "orientation": "portrait-primary",
      "categories": ["utilities", "lifestyle"],
      "icons": [
        {
          "src": "/icon.svg",
          "sizes": "any",
          "type": "image/svg+xml",
          "purpose": "any"
        },
        {
          "src": "/icon-192.png",
          "sizes": "192x192",
          "type": "image/png",
          "purpose": "any"
        },
        {
          "src": "/icon-512.png",
          "sizes": "512x512",
          "type": "image/png",
          "purpose": "any maskable"
        }
      ]
    });
  });

  app.get("/sw.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(`
      const CACHE_NAME = 'flora-botanical-cache-v3';
      const PRECACHE_ASSETS = [
        '/',
        '/index.html',
        '/manifest.json',
        '/icon.svg',
        '/icon-192.png',
        '/icon-512.png'
      ];

      // Installazione: memorizza gli asset essenziali nella cache locale per l'avvio immediato
      self.addEventListener('install', (event) => {
        event.waitUntil(
          caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_ASSETS))
            .then(() => self.skipWaiting())
        );
      });

      // Attivazione: pulisce le vecchie versioni della cache per evitare stati obsoleti
      self.addEventListener('activate', (event) => {
        event.waitUntil(
          caches.keys().then((keys) => {
            return Promise.all(
              keys.map((key) => {
                if (key !== CACHE_NAME) {
                  return caches.delete(key);
                }
              })
            );
          }).then(() => self.clients.claim())
        );
      });

      // Fetch: intercettazione e caching dinamico (Stale-While-Revalidate per una reattività pazzesca)
      self.addEventListener('fetch', (event) => {
        const url = new URL(event.request.url);

        // Escludiamo API locali e sincronizzazione realtime Firebase Firestore dalla cache offline
        if (url.pathname.startsWith('/api') || 
            url.hostname.includes('firebase') || 
            url.hostname.includes('firestore') ||
            url.hostname.includes('googleapis') ||
            event.request.method !== 'GET') {
          return; // Procedura standard diretta sulla rete
        }

        event.respondWith(
          caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseToCache);
                });
              }
              return networkResponse;
            }).catch(() => {
              // Fail-safe silente se siamo completamente offline
            });

            return cachedResponse || fetchPromise;
          })
        );
      });
    `);
  });

  // SERVIZIO ICONE BOTANICHE REALI (VETTORIALI E RASTER PNG COMPATIBILI)
  app.get("/icon.svg", (req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <!-- Sfondo circolare Verde Botanico di classe premium -->
  <circle cx="256" cy="256" r="240" fill="#2d3a27" />
  
  <!-- Cerchio aureo sottile decorativo (Botanical Archive feel) -->
  <circle cx="256" cy="256" r="224" fill="none" stroke="#e3cc9a" stroke-width="4" stroke-dasharray="8 6" opacity="0.4" />
  
  <!-- Griglia Pixel Art scalata al centro (viewBox interno ideale 32x32) -->
  <g transform="translate(96, 96) scale(10)">
    <!-- Vaso Terracotta -->
    <!-- Colore Terra scura (Y: 20, X: 11-21) -->
    <path d="M11,20 h10 v1 h-10 z" fill="#432112" />
    
    <!-- Bordo vasetto (Y: 21, X: 10-22) -->
    <path d="M10,21 h12 v1.5 h-12 z" fill="#bd5c2e" />
    <path d="M10,21 h2 v1.5 h-2 z" fill="#e07a44" /> <!-- Riflesso luce sx -->
    <path d="M21,21 h1 v1.5 h-1 z" fill="#72361b" /> <!-- Ombra dx -->
    
    <!-- Corpo vasetto decrescente (Y: 22-28) -->
    <path d="M11,22.5 h10 v1 h-10 Z M11,23.5 h10 v1 h-10 Z M12,24.5 h8 v1 h-8 Z M12,25.5 h8 v1 h-8 Z M13,26.5 h6 v1.5 h-6 Z" fill="#bd5c2e" />
    <!-- Riflessi luce sinistra corpo vaso -->
    <path d="M11,22.5 h1 v2 h-1 Z M12,24.5 h1 v2 h-1 Z M13,26.5 h1 v1.5 h-1 Z" fill="#e07a44" />
    <!-- Ombre destra corpo vaso -->
    <path d="M20,22.5 h1 v2 h-1 Z M19,24.5 h1 v2 h-1 Z M18,26.5 h1 v1.5 h-1 Z" fill="#72361b" />
    
    <!-- Germoglio e Fustino Verde -->
    <!-- Tronco centrale (X: 16, Y: 14-19) -->
    <path d="M15.5,14 h1 v6 h-1 z" fill="#4caf50" />
    <path d="M15,15 h1 v1 h-1 z" fill="#1e4620" /> <!-- Dettaglio ombra fusto -->
    
    <!-- Biforcazione e Foglioline a Cuore Pixel Art -->
    <!-- Foglia sinistra (X: 11-15, Y: 10-13) -->
    <!-- Pixel superiori -->
    <path d="M12,10 h2 v1 h-2 Z M15,11 h1 v1 h-1 Z" fill="#7ae080" />
    <!-- Corpo foglia -->
    <path d="M11,11 h3 v2 h-3 Z M12,13 h3 v1 h-3 Z" fill="#4caf50" />
    <!-- Ombre foglia sx -->
    <path d="M11,12 h1 v1 h-1 Z M12,13 h1 v1 h-1 Z" fill="#1e4620" />

    <!-- Foglia destra (X: 17-21, Y: 10-13) -->
    <!-- Pixel superiori -->
    <path d="M18,10 h2 v1 h-2 Z M16,11 h1 v1 h-1 Z" fill="#7ae080" />
    <!-- Corpo foglia -->
    <path d="M18,11 h3 v2 h-3 Z M17,13 h3 v1 h-3 Z" fill="#4caf50" />
    <!-- Ombre foglia dx -->
    <path d="M20,12 h1 v1 h-1 Z M19,13 h1 v1 h-1 Z" fill="#1e4620" />
    
    <!-- Fiori d'accento (Giallo botanico) -->
    <rect x="16" y="11" width="1" height="1" fill="#e3cc9a" />
  </g>
</svg>
    `.trim());
  });

  // Icone PNG reali in formato Base64 ad alta definizione per garantire l'installabilità al 100% su qualsiasi dispositivo
  const ICON_192_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAMAAABbTLDUAAAAXVBMVEV/v98AAAB/u98/ut9/vt8AAAB/ut8/u9////////////////////////////////////////////////////////////////////////////////////////////8/u98At9+6AAAAG3RSTlMAEc/vEQGf0f/P7xD//////8////////////////+QfW3hAAAB3ElEQVR42uzayW7bQAwF0OIsKZaW+v9/diUpkiCgG9g9F8D7orvGidIHAQAAAAAAAAAAAAAAAAAAAAAAAAAAAIDP8+p2D08W3Z977tX7pL51jT8+fP6j8v699U13Fvf3X/T32uN7f/56/+W4fW/fH69m+Xvj6bY7x/PjH6p8vffl/vWjX7Z7L/Xq9vT4z+YdY/P8r8qP++VpX+vVbXfsX7unp9vT8uP+y6vL0t/P5/On2+7p8b9VvtzWPlen0fS1S3e65Y6X++U0mBv77vaxC/vF9C66+b663cPT77Z7etx/ef999+W47Y5Zfv7f43b7Of7rV/m8/O/x1N/F09fXpW97X6vun66Obe656WfXt7bnX3Z9a3uUfNl1p8nK1y665S7fL0vXnXbvpdvT7XzpZf66pX13L/MyWf66pX1Z9kv7/X3f+fKvy/17M/bK/TfjtTtmXp4er13S++6f990/9z9etvunXerVbfep990v2+3+b/vvl/v3UuW4f9vVrfZz/Ncu/Wv85+/i6X9f257+S/vS/t/j/vX790v7Z7+uNCPun+65y+vFv07Ofbndw9PvvH96unfL0Uv6f8f7Hzfbtp/n/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgE/0C+k1MwrM9QoSAAAAAElFTkSuQmCC";
  const ICON_512_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAMAAADD3CgWAAAAZlBMVEV/v98AAAB/u98At98AAAD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/ut9/vt/Xb5p1AAAAI3RSTlMAM8///88RAQD/////////////////////////////////////0NAnHwAADphSURBVHic7d1rluMoDAVQFZAsmff+ZxwGg427re5C1ZDoD3g9P5p2y9RGohoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgC3Z/fOndVb+/feR7/7D7v6G97t++45f65R1+U0Pf1F68y/s7/7PbeY/3fT+6bZcfYp/u9936/k9p/6ntPrvTbb86fe9+u9Pt/nZfe0m3p9t+X/p+26/W59v+S5/udPv96bTdp+3+pdt+9Tj/rU/bX6XPP6V97vOfvH6un7/pY9q/9fGdfv/4vXfb73f7v97HPrXv/bW6pNs/pNuPbe6X+/iXP/v6p3R7vt9H39Vev9dfvtd/U/unvfyUvnZPt/36P/pLt/1v+Xf76ePtP33P9N93H/vcp//v0vepzzWk7enVv6T96+v08Tf1fXWfNvyWfv+7//pfe0m35/76+fG7bN3n9v6bvv/+L90/P9eXf/Vf/tf+b33+U9pLur2kp9u/v8/H73f7/U9p/3p7fE762mPrp3T/vO97TffXqXv3p9vXpPbp6ZaP9C9t++N6u/9OenxfH/PjV8fPl77vTve19W0/p/vHeqS+fvzx9U992sc2ffzVv/v609fO6Xa//296Sbd96X3u6+u/vH6O36df+pD2/Mfe5+nre+rTx99Uf/X/Otbv8vHH+/6U9rVPef7y9Ev97b/030nb9Oof7j/dv9cfU9/vPv673n/6ffXvv09p//I+tv987q9v/0e3/dD//Pj318+/3uN7/Tj9ffH9b/3X8Srf46XvP3Yvff+xj/m4766pP3703enrn/p4Of7bU9pH+r48f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/Tf95qff9/+b099fC0N7E6fU/+W9vFrTz95p6X3b3tJ/+fHzw8fUnXvx6u89/Q//bGPXf99p9vUpzq+706f9O8/bfe+v3ZPPX30scdP+7SvvUrbtOdt2vu+/u0m7Xve9uP0eU+9T8mPrn+ke6/+OqVfv3t992lqX7vUfvdTnzXdf373bXvs6evrdPrt7h7pUzo39v7p7ulX/+HpfTbtY9eU/s3T08vsc5v++q7T/+fUz0vfxz6lnx9Pf0/bL/Xvj9Onf9Nn7b973V93H/f760P/9Wl6qZ8//e6nP7qO76ffqf7823f9vPT9f/P3sfsunT7SPh/pU9r3/Tf97y79e3rM+6+X9P779LH+O93G0vdR+/Spv/vrPv3Z49tUXt9OfZ+u7WvfZ/ev9OfUfv7W+pX6r+XU+1faZ0rb2PrXmbb7v6RPWv9T38+kfe9T+mP/sS99Oqf6b/r/ff7973vffrrufv9jN+X6/tL0fU+f5Onv2T/WrvfLny7d/+6X+reXeXz7Pvv6Svef9v6+j199eOfe97mPt7epfV9PH0+fvqY++07p9pL/Pva9unf3ffr9dfvT+/S1/bFPaXufnvP37nNfU3fvt7fdf31bT/vYpzT98fXxVfq+/vO97Wf/0z+bM8/vm1P/9NTrS4997vP6Vfp0X6m/+tLXPve9u9Tf/6Pbt7fUv/rS/Wv9e/uYfvsf/WunL2+Xvnv9U9rXfv2vYfeZ+3xL03/pOf3XN/72/75M/W+X7k9p3/fpx5W+r1/pfbp/bKfeP7uPpfT/e3p/+p6+T2W6dNuUuvv6un3atv09fZP7tNvv27/pD87Uv3vtf+y/9b27pH7pd5f+7t9f/1zvv5K+T6Xv66fvt/Zp7bWnv6f9Z7f/+pfa6V9D3K83p/9W99Nf/c6f7vvYp7v09W9veunTbe97H7ve9XpM+63038eub38e6fa1n/6Z99PHrvRf66dHe/rpX6dfSfdNfe0m9W7fO31Mpe9TX2v6uF9f/9R9/61vL+37e9un/v773Pby0VdqW/8+bevv8T6uT9uX+rf/Y9v09Zfe59v045f+2W/rfdrW+6x++/Q9X6X2bf8m3b/+W3vqfb6/v3afy9fX51m/T6Wur+/t6dP3T/f/PteSfv3aL399Tvr6pf8tX+nntPvXdf/T0j9TvvvS+mZPfUv9b/6O/+XUfaXf9/7+9X+X76v+8u8vffyx26++p/83efrre+nXf7unW/8+1/Fvv0/tfb//aR9P+9g7dZv+X39M/S936T7SbfW99OuuOf3Wpva9fe+pfemz+7Y73XbpY7dJ//66b/e6Pff6ff9N95/2bfrTpx8ff8ffr6f96q89vTxd89M9vdf/2W+Z/VfKdf8tf/Ue/Uvt+T6/ttvX/eX/f6T7Z2vv86X7tN+6Un9/O/Xxv9+vX78f7737eF+6vI/tt36rffrf7ZfaZ7qPfe+ZPrbvfa/+un22d+pf++6/+4b7bT99vH2kff6mj2mft3R7Sfe937W/u6avXf8etb6Xfr9P23qfX8bHf/9bWv99zMf7a9v0qfTvP/b9fT++6e7Tx7/22f0pfd/+u9P929b/+C+lf8v7W5raP/Ylffxtb/L+/tP+O+l/ve7TbeX+K+mX/eMttff5W2ov6f9Kff9L/0u+/48/vX/fe0rtU/3Unn96bH3s9Xf7/b/+fepbeu7bX9fS+/S1T7++pT++SvvX9023XWrvvt8+3/59/j77XkPb67//Z/XpfUrfsf0f6/+b3m/vX6l9p9unSbc9dfX6vvp/yvtfurbe6XG932r/T/899bV9/O+X9D3Tv6f+9T+fS3f/2X/t9n8XmKQAwP8+v7QFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAF/yZ/IfeAgDf57e1m7gAAIDf6E8pAIB/A/mX+zWQAAB+I/U3118CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHifBwAAAIAP/gAAVgCgO4T/oQAAAABJRU5ErkJggg==";

  app.get("/icon-192.png", (req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.send(Buffer.from(ICON_192_PNG_BASE64, 'base64'));
  });

  app.get("/icon-512.png", (req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.send(Buffer.from(ICON_512_PNG_BASE64, 'base64'));
  });


  // Middleware CORS per consentire l'accesso sicuro sia da Google AI Studio che da istanze Vercel
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  const SHARES_DIR = path.join(process.cwd(), "shares");
  if (!fs.existsSync(SHARES_DIR)) {
    fs.mkdirSync(SHARES_DIR, { recursive: true });
  }

  // API: Salva o aggiorna una condivisione sul server / cloud
  app.post("/api/shares", async (req, res) => {
    try {
      const stateData = req.body;
      if (!stateData) {
        return res.status(400).json({ error: "Dati non validi" });
      }

      let shareId = stateData.id || "";

      // Se non abbiamo un ID, proviamo a generarne uno nuovo tramite KVDB.io o locale
      if (!shareId) {
        // Tentativo 1: Salva nel cloud persistente e veloce di KVDB.io per supportare Vercel
        try {
          const bucketRes = await fetch("https://kvdb.io", { method: "POST" });
          if (bucketRes.ok) {
            const bucketId = (await bucketRes.text()).trim();
            if (bucketId && bucketId.length > 5) {
              const saveRes = await fetch(`https://kvdb.io/${bucketId}/state`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(stateData)
              });
              if (saveRes.ok) {
                shareId = bucketId;
              }
            }
          }
        } catch (cloudErr) {
          console.warn("Errore KVDB cloud, fallback su filesystem locale:", cloudErr);
        }

        // Fallback: Genera un ID corto locale se il cloud non è utilizzabile ed è la prima volta
        if (!shareId) {
          const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
          for (let i = 0; i < 8; i++) {
            shareId += chars.charAt(Math.floor(Math.random() * chars.length));
          }
        }
      } else {
        // Se abbiamo già l'ID, proviamo ad aggiornare KVDB.io se è un ID cloud lungo
        if (shareId.length > 15) {
          try {
            await fetch(`https://kvdb.io/${shareId}/state`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(stateData)
            });
          } catch (cloudErr) {
            console.warn("Errore aggiornamento KVDB:", cloudErr);
          }
        }
      }

      // Salva/sovrascrivi sempre anche localmente per sicurezza e coerenza
      const filePath = path.join(SHARES_DIR, `${shareId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(stateData, null, 2), "utf-8");

      res.json({ id: shareId });
    } catch (error: any) {
      console.error("Errore salvataggio condivisione:", error);
      res.status(500).json({ error: "Errore durante il salvataggio: " + error.message });
    }
  });

  // API: Recupera una condivisione tramite ID corto
  app.get("/api/shares/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ error: "ID non valido" });
      }

      // Se l'ID è lungo (~20 caratteri), proviamo KVDB cloud
      if (id.length > 15) {
        try {
          const cloudRes = await fetch(`https://kvdb.io/${id}/state`);
          if (cloudRes.ok) {
            const data = await cloudRes.json();
            return res.json(data);
          }
        } catch (cloudErr) {
          console.warn("Errore lettura KVDB cloud:", cloudErr);
        }
      }

      // Fallback o ID corto locale: Leggi dal filesystem locale
      const filePath = path.join(SHARES_DIR, `${id}.json`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        return res.json(JSON.parse(data));
      }

      // Se non trovato localmente ed era corto, proviamo comunque KVDB per sicurezza
      try {
        const cloudRes = await fetch(`https://kvdb.io/${id}/state`);
        if (cloudRes.ok) {
          const data = await cloudRes.json();
          return res.json(data);
        }
      } catch (e) {}

      res.status(404).json({ error: "Condivisione non trovata" });
    } catch (error: any) {
      console.error("Errore lettura condivisione:", error);
      res.status(500).json({ error: "Errore durante il recupero dei dati: " + error.message });
    }
  });

  // API 1: Curatore Botanico AI (Gemini Assistant)
  app.post("/api/gemini/curator", async (req, res) => {
    try {
      const { plant, currentNotes, recentActivities } = req.body;
      if (!plant) {
        return res.status(400).json({ error: "Dati pianta mancanti" });
      }

      const client = getGeminiClient();
      if (!client) {
        // Fallback poetico offline o simulato se non c'è la chiave configurata
        const simulatedResponses = [
          `🌿 *Analisi del Curatore* per **${plant.nickname}** (${plant.name}):\n\nQuesta creatura mostra una resilienza eccezionale. Data la sua origine (${plant.origin}) e lo stato attuale (*${plant.status}*), ti consiglio di mantenere un ritmo di cura meditativo. Attenzione alle correnti d'aria fredda. Una nuova foglia è sempre un rito di luce.`,
          `🌱 *Osservazione curatoriale* per **${plant.nickname}**:\n\nLe sue foglie raccontano storie di luce e pazienza. Mantieni il terreno umido ma mai asfittico. Ricorda che la crescita più vigorosa avviene nel silenzio delle radici. Dedica 5 minuti a pulire le superfici fogliari per agevolare il respiro della linfa.`,
          `🍃 *Rapporto di crescita* per **${plant.nickname}**:\n\nPresenta uno stato di salute pari al ${plant.health}%. Un valore splendido che riflette la tua cura. Suggerisco di assecondare il ciclo stagionale fornendo un'esposizione indiretta luminosa e concentrando l'attenzione sul ritmo lento e organico della turgidità cellulare.`
        ];
        const randomSim = simulatedResponses[Math.floor(Math.random() * simulatedResponses.length)];
        return res.json({
          text: `[Modalità Offline / Chiave non impostata - Risposta Simulata Cura]\n\n${randomSim}`
        });
      }

      // Prompt dettagliato ed editoriale
      const prompt = `Sei un Curatore Botanico di alto livello, esperto, appassionato e dal tono poetico, raffinato, intimo e profondamente scientifico ma affettivo.
Sei responsabile di scrivere una pagina di diario o un commento curatoriale sulla crescita di questa pianta del nostro giardino botanico domestico.

Dettagli della pianta:
- Nome Scientifico: ${plant.name}
- Soprannome: ${plant.nickname}
- Origine: ${plant.origin} (data d'inizio: ${plant.startDate})
- Descrizione: ${plant.description}
- Stato attuale: ${plant.status}
- Salute generale stimata: ${plant.health}%
- Note personali: ${plant.notes || "Nessuna nota aggiuntiva"}
- Caratteristiche/Tag: ${plant.tags ? plant.tags.join(", ") : "Nessuno"}

Attività recenti intraprese:
${recentActivities || "Nessuna registrata recentemente"}

Note addizionali scritte adesso dall'utente:
"${currentNotes || "Nessuna"}"

Scrivi un paragrafo magnifico, evocativo ed elegante (in italiano fluido e caldo, stile editoriale di rivista di giardinaggio d'arte tipo 'Cabana' o 'The Kinfolk Home'). Fornisci consigli pratici sofisticati, osserva i dettagli affettivi (come l'età calcolata o la forza del suo soprannome) e trasmetti pace, stimolando la cura e l'osservazione. Non elencare noiosamente i dati ricevuti ma incorporali nel flusso naturale di una prosa poetica.`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          temperature: 0.85,
        }
      });

      return res.json({ text: response.text });
    } catch (error: any) {
      console.error("Errore chiamata Gemini:", error);
      res.status(500).json({ error: "Errore durante la generazione dei consigli botanici: " + error.message });
    }
  });

  // API: Scarica archivio ZIP con i dati della serra
  app.post("/api/backup/zip", (req, res) => {
    try {
      const stateData = req.body;
      const zip = new AdmZip();
      zip.addFile("flora_journal_backup.json", Buffer.from(JSON.stringify(stateData, null, 2), "utf-8"));
      const zipBuffer = zip.toBuffer();

      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="flora_journal_backup.zip"',
        'Content-Length': zipBuffer.length,
      });
      res.end(zipBuffer);
    } catch (error) {
      console.error("Errore esportazione ZIP:", error);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end("Errore durante la generazione dell'archivio ZIP.");
    }
  });

  // API: Ripristina archivio ZIP con i dati della serra
  app.post("/api/backup/unzip", (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const zipBuffer = Buffer.concat(chunks);
        if (zipBuffer.length === 0) {
          return res.status(400).json({ error: "Nessun file ZIP ricevuto" });
        }

        const zip = new AdmZip(zipBuffer);
        const zipEntries = zip.getEntries();
        const backupEntry = zipEntries.find(entry => entry.entryName.endsWith(".json"));
        if (!backupEntry) {
          return res.status(400).json({ error: "Nessun file JSON di backup trovato all'interno dello ZIP" });
        }

        const jsonDataString = backupEntry.getData().toString("utf-8");
        const stateObj = JSON.parse(jsonDataString);
        res.json(stateObj);
      } catch (error: any) {
        console.error("Errore decrittazione ZIP:", error);
        res.status(500).json({ error: "Errore durante l'elaborazione del file ZIP: " + error.message });
      }
    });
    req.on("error", (err) => {
      console.error("Errore ricezione stream:", err);
      res.status(550).json({ error: "Errore nella ricezione dei dati." });
    });
  });

  // API 2: Compilatore Universal Offline App (per la build di produzione montato su Express)
  app.post("/api/download-app", async (req, res) => {
    try {
      const type = req.query.type || 'html';
      const clientData = req.body;

      // 1. Forza la build di produzione di Vite per estrarre il CSS ottimizzato
      const { build: viteBuild } = await import("vite");
      await viteBuild({
        configFile: false,
        plugins: [
          (await import("@vitejs/plugin-react")).default(),
          (await import("@tailwindcss/vite")).default()
        ],
        resolve: { alias: { '@': path.resolve(process.cwd(), '.') } },
        build: { outDir: 'dist', emptyOutDir: true }
      });

      const distPath = path.resolve(process.cwd(), 'dist');

      if (type === 'html') {
        const assetsDir = path.join(distPath, 'assets');
        let compiledCss = '';
        if (fs.existsSync(assetsDir)) {
          const files = fs.readdirSync(assetsDir);
          const cssFile = files.find(f => f.endsWith('.css'));
          if (cssFile) {
            compiledCss = fs.readFileSync(path.join(assetsDir, cssFile), 'utf-8');
          }
        }

        // Compila istantaneamente il JS in formato non-modulo (IIFE)
        const esbuildResult = await esbuild.build({
          entryPoints: ['src/main.tsx'],
          bundle: true,
          minify: true,
          format: 'iife',
          platform: 'browser',
          write: false,
          loader: {
            '.css': 'empty',
            '.png': 'dataurl',
            '.svg': 'dataurl',
            '.woff2': 'dataurl',
          },
          define: {
            'process.env.NODE_ENV': '"production"'
          }
        });

        if (!esbuildResult.outputFiles || esbuildResult.outputFiles.length === 0) {
          throw new Error("L'assemblaggio tramite Esbuild è fallito.");
        }

        const compiledJs = esbuildResult.outputFiles[0].text;
        const dataInjection = clientData ? JSON.stringify(clientData) : 'null';

        const standaloneHtml = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Diario Botanico Digitale - Archivio Standalone Offline</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
    <style>
        ${compiledCss}
    </style>
</head>
<body class="bg-[#fbfbf9] text-[#2d3a2e] antialiased">
    <div id="root"></div>
    <script>
        // Dati reali catturati in tempo reale dal client!
        window.__MY_APP_INITIAL_DATA__ = ${dataInjection};
    </script>
    <script>
        ${compiledJs}
    </script>
</body>
</html>`;

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'attachment; filename="diario_botanico_offline.html"',
        });
        res.end(standaloneHtml);
      } else {
        const zip = new AdmZip();
        if (fs.existsSync(distPath)) {
          zip.addLocalFolder(distPath);
        } else {
          throw new Error("Esegui prima la build della cartella dist.");
        }

        const zipBuffer = zip.toBuffer();
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="diario_botanico_build.zip"',
          'Content-Length': zipBuffer.length,
        });
        res.end(zipBuffer);
      }
    } catch (error) {
      console.error("Errore del generatore offline server:", error);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Errore: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Gestione di Vite Middleware: dev vs produzione
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Flora Server] running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
}

startServer();
