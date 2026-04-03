import "dotenv/config";
import express from "express";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import session from 'express-session';
import cookieParser from 'cookie-parser';

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
  if (!columnNames.includes('address')) {
    await db.exec("ALTER TABLE onus ADD COLUMN address TEXT");
  }
  if (!columnNames.includes('comment')) {
    await db.exec("ALTER TABLE onus ADD COLUMN comment TEXT");
  }
  if (!columnNames.includes('zone_name')) {
    await db.exec("ALTER TABLE onus ADD COLUMN zone_name TEXT");
  }
  if (!columnNames.includes('status_changed_at')) {
    await db.exec("ALTER TABLE onus ADD COLUMN status_changed_at DATETIME");
    await db.run("UPDATE onus SET status_changed_at = CURRENT_TIMESTAMP WHERE status_changed_at IS NULL");
  }

  // PRAGMA for port_alerts migrations
  const portAlertCols = await db.all("PRAGMA table_info(port_alerts)");
  const portAlertColNames = portAlertCols.map((c: any) => c.name);
  if (!portAlertColNames.includes('consecutive_healthy')) {
    await db.exec("ALTER TABLE port_alerts ADD COLUMN consecutive_healthy INTEGER DEFAULT 0");
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
      consecutive_healthy INTEGER DEFAULT 0,
      last_notified DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS special_onus (
      sn TEXT PRIMARY KEY,
      name TEXT,
      alert_on_los INTEGER DEFAULT 1,
      alert_on_power_fail INTEGER DEFAULT 1,
      alert_on_offline INTEGER DEFAULT 0,
      last_status TEXT,
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

  let apiSuccess = false;
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

    if (statusMap.size > 0 || rawStatuses.length > 0) apiSuccess = true;

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
      admin_status: adminStatus || "Unknown",
      is_live: !!liveStatus
    };
  });

  return { merged, apiSuccess };
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
  
  app.set('trust proxy', 1); 

  app.use(express.json());
  app.use(cookieParser());
  app.use(session({
    secret: process.env.SESSION_SECRET || 'smartolt-monitor-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
      secure: true, 
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Auth Middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if ((req.session as any).user) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

  // Auth Endpoints
  app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    if (email === "kaledmoly@gmail.com" && password === "colombia2025**") {
      (req.session as any).user = { email };
      res.json({ success: true, user: { email } });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/auth-check", (req, res) => {
    if ((req.session as any).user) {
      res.json({ authenticated: true, user: (req.session as any).user });
    } else {
      res.json({ authenticated: false });
    }
  });

  app.post("/api/logout", (req, res) => {
    (req.session as any).destroy((err: any) => {
      if (err) return res.status(500).json({ error: "Could not log out" });
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });

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

  // Local API - Trigger Sync (Protected)
  app.post("/api/local/sync", requireAuth, async (req, res) => {
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
            `INSERT INTO onus (sn, name, unique_external_id, olt_id, board, port, onu, zone_id, zone_name, hardware_type, status, address, comment, status_changed_at, raw_data, last_updated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(sn) DO UPDATE SET 
              name=excluded.name, 
              unique_external_id=excluded.unique_external_id,
              olt_id=excluded.olt_id, 
              board=excluded.board, 
              port=excluded.port, 
              onu=excluded.onu,
              zone_id=excluded.zone_id,
              zone_name=excluded.zone_name,
              hardware_type=excluded.hardware_type,
              address=excluded.address,
              comment=excluded.comment,
              status_changed_at = CASE WHEN status != excluded.status THEN CURRENT_TIMESTAMP ELSE status_changed_at END,
              status=excluded.status,
              raw_data=excluded.raw_data,
              last_updated=CURRENT_TIMESTAMP`,
            [
              sn, onu.name || `ONU ${sn}`, onu.unique_external_id, onu.olt_id, onu.board, onu.port, onu.onu, onu.zone_id, onu.zone_name || onu.zone_id || '', onu.onu_type_name || onu.hardware_type, onu.status, onu.address || '', onu.comment || '', JSON.stringify(onu)
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

  // Local API - Last Sync Status (Protected)
  app.get("/api/local/sync-status", requireAuth, async (req, res) => {
    try {
      const row = await db.get("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1");
      res.json(row || { sync_time: null, sync_type: null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Local API - Get ONUs (Protected)
  app.get("/api/local/onus", requireAuth, async (req, res) => {
    try {
      const { merged } = await getOnusWithStatus();
      res.json(merged);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Local API - Special ONUs Management (Protected)
  app.get("/api/local/special-onus", requireAuth, async (req, res) => {
    try {
      const rows = await db.all("SELECT * FROM special_onus");
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/local/special-onus", requireAuth, async (req, res) => {
    try {
      let { sn, name, alert_on_los, alert_on_power_fail, alert_on_offline } = req.body;
      if (!sn) return res.status(400).json({ error: "Serial number is required" });
      
      sn = sn.trim().toUpperCase();

      // STRICT VALIDATION: Check if ONU exists in main cache
      const onu = await db.get("SELECT name FROM onus WHERE sn = ?", [sn]);
      if (!onu) {
        return res.status(404).json({ error: "La ONU no existe o no ha sido sincronizada todavía." });
      }

      const finalName = name || onu.name || `ONU ${sn}`;

      await db.run(
        `INSERT INTO special_onus (sn, name, alert_on_los, alert_on_power_fail, alert_on_offline)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sn) DO UPDATE SET 
          name=excluded.name,
          alert_on_los=excluded.alert_on_los,
          alert_on_power_fail=excluded.alert_on_power_fail,
          alert_on_offline=excluded.alert_on_offline`,
        [sn, finalName, alert_on_los ? 1 : 0, alert_on_power_fail ? 1 : 0, alert_on_offline ? 1 : 0]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/local/special-onus/:sn", requireAuth, async (req, res) => {
    try {
      await db.run("DELETE FROM special_onus WHERE sn = ?", [req.params.sn.toUpperCase()]);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Local API - Settings Management (Protected)
  app.get("/api/local/settings", requireAuth, async (req, res) => {
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

  app.post("/api/local/settings", requireAuth, async (req, res) => {
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

  // Local API - Get Report of Fallen Ports (Protected)
  app.get("/api/local/fallen-ports", requireAuth, async (req, res) => {
    try {
      const thresholdRow = await db.get("SELECT value FROM settings WHERE key = 'FALLEN_PORT_THRESHOLD'");
      const threshold = parseInt(thresholdRow?.value || '7');

      const { merged: onus } = await getOnusWithStatus();

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

      const { merged: onus, apiSuccess } = await getOnusWithStatus();
      if (!apiSuccess) {
        console.warn("[CRON] Skipping check because live status API failed or returned 0 items.");
        return;
      }

      const portMap = new Map();
      onus.forEach((o: any) => {
        const key = `${o.olt_id}-${o.board}-${o.port}`;
        if (!portMap.has(key)) {
          portMap.set(key, { olt_id: o.olt_id, board: o.board, port: o.port, total: 0, los: 0, totalFailures: 0, barrios: new Set(), zonas: new Set() });
        }
        const p = portMap.get(key);
        p.total++;
        const status = (o.status || "").toLowerCase();
        if (status === 'los') {
          p.los++;
          p.totalFailures++;
          const barrio = (o.address || o.comment || "").trim();
          if (barrio) p.barrios.add(barrio);
          const zona = (o.zone_name || "").trim();
          if (zona) p.zonas.add(zona);
        } else if (status === 'power fail' || status === 'offline' || status === 'dying gasp') {
          p.totalFailures++;
        }
      });

      // UMBRALES HISTERESIS Y SEPARACION LOGICA:
      // Alerta: solo LOS >= 35%.
      // Recuperación: solo si FALLO TOTAL (LOS + Power + Offline) < 15%.
      const currentStatusMap = new Map(Array.from(portMap.values()).map(p => {
        const losPercentage = Math.round((p.los / p.total) * 100);
        const totalFailurePercentage = Math.round((p.totalFailures / p.total) * 100);
        return [`${p.olt_id}-${p.board}-${p.port}`, { ...p, losPercentage, totalFailurePercentage }];
      }));

      const previousAlerts = await db.all("SELECT * FROM port_alerts");
      const previousMap = new Map(previousAlerts.map(a => [a.port_key, a]));

      const triggerAlertKeys: string[] = [];
      const triggerRecoveryKeys: string[] = [];

      for (const [key, p] of currentStatusMap.entries()) {
        const prev = previousMap.get(key) as any;
        const isFallenNowByFiber = p.total > threshold && (p as any).losPercentage >= 35;
        const isHealthyNowByTotal = (p as any).totalFailurePercentage < 15;

        if (isFallenNowByFiber) {
          // Si estaba recuperado o era nuevo, lanzar alerta
          if (!prev || prev.status !== 'FALLEN') {
            triggerAlertKeys.push(key);
            await db.run(
              "INSERT INTO port_alerts (port_key, last_percentage, status, consecutive_healthy, last_notified) VALUES (?, ?, 'FALLEN', 0, CURRENT_TIMESTAMP) ON CONFLICT(port_key) DO UPDATE SET status='FALLEN', consecutive_healthy=0, last_percentage=excluded.last_percentage, last_notified=CURRENT_TIMESTAMP",
              [key, (p as any).losPercentage]
            );
          } else {
            // Ya estaba en alerta, resetear contador salud y actualizar porcentaje de fibra
            await db.run("UPDATE port_alerts SET consecutive_healthy = 0, last_percentage = ? WHERE port_key = ?", [(p as any).losPercentage, key]);
          }
        } else if (prev && prev.status === 'FALLEN' && isHealthyNowByTotal) {
          // Proceso de recuperación con persistencia (3 ciclos)
          const newCount = (prev.consecutive_healthy || 0) + 1;
          if (newCount >= 3) {
            triggerRecoveryKeys.push(key);
            await db.run("UPDATE port_alerts SET status = 'RECOVERED', consecutive_healthy = ?, last_notified = CURRENT_TIMESTAMP WHERE port_key = ?", [newCount, key]);
          } else {
            console.log(`[CRON] Port ${key} is total healthy (${(p as any).totalFailurePercentage}%) but needs ${3 - newCount} more cycles for recovery.`);
            await db.run("UPDATE port_alerts SET consecutive_healthy = ? WHERE port_key = ?", [newCount, key]);
          }
        } else if (prev && prev.status === 'FALLEN' && !isHealthyNowByTotal) {
          // El corte de fibra ya no es > 35%, PERO sigue habiendo corte de luz u otros fallos (Fallo Total >= 15%)
          // Resetear contador para evitar recuperaciones falsas durante el corte de luz
          if (prev.consecutive_healthy !== 0) {
            await db.run("UPDATE port_alerts SET consecutive_healthy = 0 WHERE port_key = ?", [key]);
          }
        }
      }

      // Detectar puertos que ya no están en el reporte (tal vez borrados o movidos) - tratarlos como recuperados si estaban alerta?
      // Por simplicidad, el loop anterior cubre lo que está actualmente en el mapa.

      if (triggerAlertKeys.length > 0) {
        console.log(`[CRON] Detected ${triggerAlertKeys.length} NEW fallen ports. Sending ALERT to n8n...`);
        const alertData = triggerAlertKeys.map(k => currentStatusMap.get(k));
        await axios.post(N8N_WEBHOOK_URL, { type: 'ALERT', ports: alertData });
      }

      if (triggerRecoveryKeys.length > 0) {
        console.log(`[CRON] Detected ${triggerRecoveryKeys.length} RECOVERED ports. Sending RECOVERY to n8n...`);
        const recoveredData = triggerRecoveryKeys.map(k => {
          const [olt_id, board, port] = k.split('-');
          return { olt_id, board, port, key: k };
        });
        await axios.post(N8N_WEBHOOK_URL, { type: 'RECOVERY', ports: recoveredData });
      }

      // --- SPECIAL ONUS MONITORING ---
      const specialOnusList = await db.all("SELECT * FROM special_onus");
      for (const spec of specialOnusList) {
        // Encontrar estado actual en nuestra caché de ONUs
        const currentOnu = onus.find(o => o.sn === spec.sn);
        if (!currentOnu) continue;

        const currentStatus = (currentOnu.status || "Unknown").toLowerCase();
        const lastStatus = (spec.last_status || "online").toLowerCase();

        if (currentStatus !== lastStatus) {
           let shouldAlert = false;
           let type = "SPECIAL_ALERT";

           if (currentStatus === "online" && lastStatus !== "online") {
              shouldAlert = true;
              type = "SPECIAL_RECOVERY";
           } else if (currentStatus === "los" && spec.alert_on_los) {
              shouldAlert = true;
           } else if (currentStatus === "power fail" && spec.alert_on_power_fail) {
              shouldAlert = true;
           } else if (currentStatus === "offline" && spec.alert_on_offline) {
              shouldAlert = true;
           }

           if (shouldAlert) {
              console.log(`[CRON] Special ONU ${spec.sn} changed status from ${lastStatus} to ${currentStatus}. Sending n8n...`);
              await axios.post(N8N_WEBHOOK_URL, { 
                type, 
                onu: {
                  sn: currentOnu.sn,
                  name: currentOnu.name,
                  status: currentOnu.status,
                  olt_id: currentOnu.olt_id,
                  board: currentOnu.board,
                  port: currentOnu.port,
                  zone: currentOnu.zone_name || currentOnu.zone_id
                }
              });
              await db.run("UPDATE special_onus SET last_status = ?, last_notified = CURRENT_TIMESTAMP WHERE sn = ?", [currentStatus, spec.sn]);
           }
        }
      }



    } catch (err: any) {
      console.error("[CRON] Status check failed:", err.message);
    }
  }, 60000);
}

startServer();
