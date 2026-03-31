import "dotenv/config";
import express from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.SMARTOLT_API_KEY || "3332756bd57545ba99a55b54fa666c18";
const TARGET_HOST = process.env.SMARTOLT_TARGET_HOST || "intalnet.vortex-m2.com";
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "https://n8n.intalnet.com/webhook/smartolt-report";

let db: any;

async function initDB() {
  const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, 'smartolt_cache.db');
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS onus (
      sn TEXT PRIMARY KEY,
      name TEXT,
      unique_external_id TEXT,
      olt_id TEXT,
      board TEXT,
      port TEXT,
      onu TEXT,
      zone_id TEXT,
      hardware_type TEXT,
      status TEXT,
      raw_data TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: Add new columns if they don't exist
  const columns = await db.all("PRAGMA table_info(onus)");
  const columnNames = columns.map((c: any) => c.name);

  if (!columnNames.includes('upload_speed')) {
    await db.exec("ALTER TABLE onus ADD COLUMN upload_speed TEXT");
  }
  if (!columnNames.includes('download_speed')) {
    await db.exec("ALTER TABLE onus ADD COLUMN download_speed TEXT");
  }
  if (!columnNames.includes('status_changed_at')) {
    await db.exec("ALTER TABLE onus ADD COLUMN status_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT,
      inserted_count INTEGER,
      sync_time DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS port_alerts (
      port_key TEXT PRIMARY KEY,
      last_percentage INTEGER,
      status TEXT,
      last_notified DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Set default threshold if not exists
  await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('FALLEN_PORT_THRESHOLD', '7')");

  // Optimization: Enable WAL mode for better concurrency and speed
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA synchronous = NORMAL');

  console.log("SQLite Database initialized (WAL mode enabled).");
}

const axiosConfig = {
  headers: {
    "X-Token": API_KEY,
    "X-API-Key": API_KEY,
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0"
  },
  timeout: 600000 // 10 minutes timeout for SmartOLT heavy requests
};

// Reusable logic to get ONUs with status without internal HTTP calls
async function getOnusWithStatus() {
  const dbOnus = await db.all("SELECT * FROM onus");

  let statusMap = new Map();
  let adminStatusMap = new Map();

  try {
    // Fetch running statuses
    console.log("[API] Fetching live statuses from SmartOLT...");
    const statusRes = await axios.get(`https://${TARGET_HOST}/api/onu/get_onus_statuses`, axiosConfig);
    let statusData = statusRes.data;
    if (Array.isArray(statusData) && statusData.length === 1 && statusData[0].onus) statusData = statusData[0];

    let rawStatuses: any[] = [];
    if (Array.isArray(statusData)) {
      rawStatuses = statusData;
    } else if (statusData && Array.isArray(statusData.onus)) {
      rawStatuses = statusData.onus;
    } else if (statusData && Array.isArray(statusData.response)) {
      rawStatuses = statusData.response;
    } else if (statusData && Array.isArray(statusData.data)) {
      rawStatuses = statusData.data;
    } else if (statusData && typeof statusData === "object") {
      Object.entries(statusData).forEach(([k, v]) => {
        if (k !== "status" && typeof v === "string") {
          const sn = k.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
          statusMap.set(sn, v);
        }
      });
    }

    rawStatuses.forEach((s: any) => {
      const sn = (s.sn || s.onu_sn || s.serial_number || s.serial || "").toString().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (sn) statusMap.set(sn, s.status || s.onu_status || s.phase_state || s.state || s.run_state);
    });

    // Also fetch administrative statuses
    console.log("[API] Fetching administrative statuses from SmartOLT...");
    const adminRes = await axios.get(`https://${TARGET_HOST}/api/onu/get_onus_administrative_statuses`, axiosConfig);
    const adminData = Array.isArray(adminRes.data) ? adminRes.data : (adminRes.data.response || []);
    adminData.forEach((s: any) => {
      const sn = (s.sn || "").toString().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (sn) adminStatusMap.set(sn, s.admin_status);
    });

  } catch (err: any) {
    console.warn("Failed to fetch live statuses from SmartOLT:", err.message);
  }

  const merged = dbOnus.map((o: any) => {
    let liveStatus = statusMap.get(o.sn);
    const adminStatus = adminStatusMap.get(o.sn);

    if (adminStatus && adminStatus.toLowerCase() === 'disabled') {
      liveStatus = 'Disabled';
    }

    return {
      ...o,
      status: liveStatus || o.status || "Unknown",
      admin_status: adminStatus || "Unknown"
    };
  });

  return merged;
}

// Background enrichment task for Speed Profiles
async function enrichOnuSpeeds() {
  try {
    const candidates = await db.all(
      "SELECT sn, unique_external_id FROM onus WHERE upload_speed IS NULL AND unique_external_id IS NOT NULL LIMIT 5"
    );

    if (candidates.length === 0) return;

    console.log(`[ENRICH] Fetching speed profiles for ${candidates.length} ONUs...`);
    for (const onu of candidates) {
      try {
        const res = await axios.get(`https://${TARGET_HOST}/api/onu/get_onu_speed_profiles/${onu.unique_external_id}`, axiosConfig);
        const data = res.data;
        if (data && data.status) {
          const upload = data.response?.upload_speed_profile_name || "Unknown";
          const download = data.response?.download_speed_profile_name || "Unknown";
          
          await db.run(
            "UPDATE onus SET upload_speed = ?, download_speed = ? WHERE sn = ?",
            [upload, download, onu.sn]
          );
        }
      } catch (err: any) {
         if (err.response?.status === 400 || err.response?.status === 404) {
           await db.run("UPDATE onus SET upload_speed='Unknown', download_speed='Unknown' WHERE sn=?", [onu.sn]);
         } else {
           throw err;
         }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch (err: any) {
    console.error("[ENRICH] Speed profile fetch failed:", err.message);
  }
}

async function startServer() {
  await initDB();
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${req.method}] ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // Proxy endpoint for SmartOLT API
  app.get("/api/smartolt/:host/*", async (req, res) => {
    const { host } = req.params;
    const apiPath = req.params[0];
    const queryParams = new URLSearchParams(req.query as any).toString();
    const targetHost = host.includes(".") ? host : `${host}.smartolt.com`;
    const url = `https://${targetHost}/api/${apiPath}${queryParams ? "?" + queryParams : ""}`;

    try {
      const response = await axios.get(url, axiosConfig);
      res.json(response.data);
    } catch (error: any) {
      const status = error.response?.status || 500;
      res.status(status).json({
        error: error.message,
        details: error.response?.data
      });
    }
  });

  // Local API - Trigger Sync
  app.post("/api/local/sync", async (req, res) => {
    try {
      console.log("Starting DB Sync...");
      let rawOnus: any[] = [];
      let usedFallback = false;

      try {
        const detailsRes = await axios.get(`https://${TARGET_HOST}/api/onu/get_all_onus_details`, axiosConfig);
        rawOnus = Array.isArray(detailsRes.data) ? detailsRes.data : (detailsRes.data.onus || detailsRes.data.data || []);
      } catch (err: any) {
        console.warn(`[Sync] Primary sync failed (${err.response?.status || err.message}). Switching to fallback signals.`);
        usedFallback = true;
        try {
          const signalsRes = await axios.get(`https://${TARGET_HOST}/api/onu/get_onus_signals`, axiosConfig);
          const sigs = Array.isArray(signalsRes.data) ? signalsRes.data : (signalsRes.data.response || signalsRes.data.data || []);
          rawOnus = sigs.map((s: any) => ({
            sn: s.sn,
            name: `ONU ${s.sn}`,
            olt_id: s.olt_id,
            board: s.board,
            port: s.port,
            onu: s.onu,
            zone_id: s.zone_id,
            status: s.status || 'Unknown'
          }));
        } catch (fallbackErr: any) {
             console.error("[Sync] Fallback signals also failed:", fallbackErr.message);
             throw fallbackErr;
        }
      }

      // Upsert into SQLite
      let inserted = 0;
      await db.run("BEGIN TRANSACTION");
      try {
        for (const onu of rawOnus) {
          const sn = (onu.sn || onu.onu_sn || onu.serial_number || onu.serial || "").toString().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
          if (!sn) continue;

          await db.run(
            `INSERT INTO onus (sn, name, unique_external_id, olt_id, board, port, onu, zone_id, hardware_type, status, status_changed_at, raw_data, last_updated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(sn) DO UPDATE SET 
              name=excluded.name, 
              unique_external_id=excluded.unique_external_id,
              olt_id=excluded.olt_id, 
              board=excluded.board, 
              port=excluded.port, 
              onu=excluded.onu,
              zone_id=excluded.zone_id,
              hardware_type=excluded.hardware_type,
              status_changed_at = CASE WHEN status != excluded.status THEN CURRENT_TIMESTAMP ELSE status_changed_at END,
              status=excluded.status,
              raw_data=excluded.raw_data,
              last_updated=CURRENT_TIMESTAMP`,
            [
              sn, onu.name || `ONU ${sn}`, onu.unique_external_id, onu.olt_id, onu.board, onu.port, onu.onu, onu.zone_id, onu.onu_type_name || onu.hardware_type, onu.status, JSON.stringify(onu)
            ]
          );
          inserted++;
        }

        await db.run(
          `INSERT INTO sync_logs (sync_type, inserted_count, sync_time) VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [usedFallback ? 'FALLBACK' : 'FULL', inserted]
        );
        await db.run("COMMIT");
      } catch (err) {
        await db.run("ROLLBACK");
        throw err;
      }

      res.json({ success: true, count: inserted, fallback: usedFallback });
    } catch (error: any) {
      console.error("Sync Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Local API - Last Sync Status
  app.get("/api/local/sync-status", async (req, res) => {
    try {
      const row = await db.get("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1");
      res.json(row || { sync_time: null, sync_type: null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Local API - Get ONUs
  app.get("/api/local/onus", async (req, res) => {
    try {
      const merged = await getOnusWithStatus();
      res.json(merged);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Local API - Settings Management
  app.get("/api/local/settings", async (req, res) => {
    try {
      const rows = await db.all("SELECT * FROM settings");
      const settings = rows.reduce((acc: any, row: any) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/local/settings", async (req, res) => {
    try {
      const updates = req.body;
      for (const [key, value] of Object.entries(updates)) {
        await db.run(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [key, String(value)]
        );
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Local API - Get Report of Fallen Ports
  app.get("/api/local/fallen-ports", async (req, res) => {
    try {
      const thresholdRow = await db.get("SELECT value FROM settings WHERE key = 'FALLEN_PORT_THRESHOLD'");
      const threshold = parseInt(thresholdRow?.value || '7');

      const onus = await getOnusWithStatus();

      const portMap = new Map();
      onus.forEach((o: any) => {
        const key = `${o.olt_id}-${o.board}-${o.port}`;
        if (!portMap.has(key)) {
          portMap.set(key, { olt_id: o.olt_id, board: o.board, port: o.port, total: 0, los: 0 });
        }
        const p = portMap.get(key);
        p.total++;
        if (o.status?.toLowerCase() === 'los') p.los++;
      });

      const fallen = Array.from(portMap.values())
        .filter(p => p.total > threshold && (p.los / p.total) >= 0.35)
        .map(p => ({
          ...p,
          percentage: Math.round((p.los / p.total) * 100)
        }));

      res.json(fallen);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // --- BACKGROUND WORKER FOR SPEED ENRICHMENT ---
  setInterval(enrichOnuSpeeds, 30000);

  // --- BACKGROUND CRON FOR N8N ---
  setInterval(async () => {
    try {
      console.log("[CRON] Checking for port status changes...");
      const thresholdRow = await db.get("SELECT value FROM settings WHERE key = 'FALLEN_PORT_THRESHOLD'");
      const threshold = parseInt(thresholdRow?.value || '7');

      const onus = await getOnusWithStatus();

      const portMap = new Map();
      onus.forEach((o: any) => {
        const key = `${o.olt_id}-${o.board}-${o.port}`;
        if (!portMap.has(key)) {
          portMap.set(key, { olt_id: o.olt_id, board: o.board, port: o.port, total: 0, los: 0 });
        }
        const p = portMap.get(key);
        p.total++;
        if (o.status?.toLowerCase() === 'los') p.los++;
      });

      const currentFallen = Array.from(portMap.values())
        .filter(p => p.total > threshold && (p.los / p.total) >= 0.35)
        .map(p => ({
          key: `${p.olt_id}-${p.board}-${p.port}`,
          olt_id: p.olt_id,
          board: p.board,
          port: p.port,
          total: p.total,
          los: p.los,
          percentage: Math.round((p.los / p.total) * 100)
        }));

      const previousAlerts = await db.all("SELECT * FROM port_alerts WHERE status = 'FALLEN'");
      const previousMap = new Map(previousAlerts.map(a => [a.port_key, a]));

      const newAlerts = currentFallen.filter(p => !previousMap.has(p.key));
      const recoveredKeys = previousAlerts
        .filter(a => !currentFallen.some(p => p.key === a.port_key))
        .map(a => a.port_key);

      if (newAlerts.length > 0) {
        console.log(`[CRON] Detected ${newAlerts.length} NEW fallen ports. Sending ALERT to n8n...`);
        await axios.post(N8N_WEBHOOK_URL, { type: 'ALERT', ports: newAlerts });
        for (const p of newAlerts) {
          await db.run(
            "INSERT INTO port_alerts (port_key, last_percentage, status, last_notified) VALUES (?, ?, 'FALLEN', CURRENT_TIMESTAMP) ON CONFLICT(port_key) DO UPDATE SET status='FALLEN', last_percentage=excluded.last_percentage, last_notified=CURRENT_TIMESTAMP",
            [p.key, p.percentage]
          );
        }
      }

      if (recoveredKeys.length > 0) {
        console.log(`[CRON] Detected ${recoveredKeys.length} RECOVERED ports. Sending RECOVERY to n8n...`);
        const recoveredData = previousAlerts.filter(a => recoveredKeys.includes(a.port_key)).map(a => {
          const [olt_id, board, port] = a.port_key.split('-');
          return { olt_id, board, port, key: a.port_key };
        });
        await axios.post(N8N_WEBHOOK_URL, { type: 'RECOVERY', ports: recoveredData });
        for (const key of recoveredKeys) {
          await db.run("UPDATE port_alerts SET status = 'RECOVERED', last_notified = CURRENT_TIMESTAMP WHERE port_key = ?", [key]);
        }
      }

      if (currentFallen.length > 0) {
        console.log(`[CRON] Sending minutely status report for ${currentFallen.length} fallen ports...`);
        await axios.post(N8N_WEBHOOK_URL, { type: 'ALERT', ports: currentFallen });
      }

    } catch (err: any) {
      console.error("[CRON] Status check failed:", err.message);
    }
  }, 60000);
}

startServer();
