const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

async function run() {
  const db = await open({
    filename: path.join(__dirname, 'smartolt_cache.db'),
    driver: sqlite3.Database
  });

  console.log("Distinct OLT IDs:");
  const olts = await db.all("SELECT DISTINCT olt_id FROM onus");
  console.log(JSON.stringify(olts, null, 2));

  console.log("\nSearching for 'MONTERIA 2' related data:");
  // Since I don't know the OLT ID for "MONTERIA 2", I'll search in raw_data or name
  const search = await db.all("SELECT sn, name, olt_id, board, port FROM onus WHERE raw_data LIKE '%MONTERIA 2%' OR name LIKE '%MONTERIA 2%' LIMIT 10");
  console.log(JSON.stringify(search, null, 2));

  console.log("\nBoards and Ports for what might be MONTERIA 2 (if found above):");
  if (search.length > 0) {
    const oltId = search[0].olt_id;
    const stats = await db.all("SELECT board, COUNT(DISTINCT port) as port_count, COUNT(*) as onu_count FROM onus WHERE olt_id = ? GROUP BY board", [oltId]);
    console.log(JSON.stringify(stats, null, 2));
    
    console.log(`\nChecking for Board 16 in OLT ${oltId}:`);
    const board16 = await db.all("SELECT DISTINCT port FROM onus WHERE olt_id = ? AND board = '16' ORDER BY CAST(port AS INTEGER)", [oltId]);
    console.log(JSON.stringify(board16, null, 2));
  }
}

run().catch(console.error);
