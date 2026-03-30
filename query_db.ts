import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const db = await open({
    filename: path.join(__dirname, 'smartolt_cache.db'),
    driver: sqlite3.Database
  });

  console.log("Analyzing 'MONTERIA 2'...");
  
  // Search for the OLT
  const oltSearch = await db.all("SELECT DISTINCT olt_id, raw_data FROM onus WHERE raw_data LIKE '%MONTERIA 2%' LIMIT 5");
  if (oltSearch.length === 0) {
    console.log("No OLT found matching 'MONTERIA 2' in raw_data.");
    // Maybe search for any OLT to see what we have
    const anyOnus = await db.all("SELECT DISTINCT olt_id FROM onus LIMIT 10");
    console.log("Found OLT IDs:", anyOnus.map(o => o.olt_id));
    return;
  }

  const oltId = oltSearch[0].olt_id;
  console.log(`Detected OLT ID: ${oltId}`);

  // Check Board 16
  const board16Ports = await db.all(
    "SELECT DISTINCT port FROM onus WHERE olt_id = ? AND (board = '16' OR board = 16) ORDER BY CAST(port AS INTEGER)", 
    [oltId]
  );
  
  console.log(`Ports found on Board 16 for OLT ${oltId}:`);
  console.log(board16Ports.map(p => p.port).join(', '));

  // Check specifically for Port 7
  const port7Onus = await db.all(
    "SELECT sn, name, status FROM onus WHERE olt_id = ? AND (board = '16' OR board = 16) AND (port = '7' OR port = 7)",
    [oltId]
  );

  console.log(`\nONUs found on OLT ${oltId}, Board 16, Port 7:`);
  if (port7Onus.length === 0) {
    console.log("NONE FOUND.");
  } else {
    console.table(port7Onus);
  }

  // List all boards for this OLT
  const boards = await db.all(
    "SELECT board, COUNT(*) as onu_count FROM onus WHERE olt_id = ? GROUP BY board ORDER BY CAST(board AS INTEGER)",
    [oltId]
  );
  console.log("\nBoard Summary for OLT:");
  console.table(boards);
}

run().catch(console.error);
