const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('smartolt_cache.db');

db.all("SELECT DISTINCT olt_id FROM onus", (err, rows) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log("OLT IDs in DB:", rows);
  
  // Try to find MONTERIA 2
  db.all("SELECT sn, name, olt_id, board, port FROM onus WHERE raw_data LIKE '%MONTERIA 2%' LIMIT 1", (err, rows) => {
    if (rows && rows.length > 0) {
      const oltId = rows[0].olt_id;
      console.log("Found MONTERIA 2 with OLT ID:", oltId);
      
      db.all("SELECT DISTINCT board FROM onus WHERE olt_id = ? ORDER BY CAST(board AS INTEGER)", [oltId], (err, rows) => {
        console.log("Boards for this OLT:", rows.map(r => r.board));
        
        db.all("SELECT DISTINCT port FROM onus WHERE olt_id = ? AND board = '16' ORDER BY CAST(port AS INTEGER)", [oltId], (err, rows) => {
            console.log("Ports for Board 16:", rows.map(r => r.port));
        });
      });
    } else {
      console.log("MONTERIA 2 not found in raw_data.");
    }
  });
});
