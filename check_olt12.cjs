const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('smartolt_cache.db');

db.all("SELECT DISTINCT board FROM onus WHERE olt_id = '12' ORDER BY CAST(board AS INTEGER)", (err, rows) => {
  if (err) {
    console.error(err);
    return;
  }
  console.log("Boards for OLT 12 in DB:", rows.map(r => r.board));
  
  db.all("SELECT DISTINCT port FROM onus WHERE olt_id = '12' AND (board = '16' OR board = 16) ORDER BY CAST(port AS INTEGER)", (err, rows) => {
    console.log("Ports for OLT 12 Board 16 in DB:", rows.map(r => r.port));
    
    db.all("SELECT COUNT(*) as count FROM onus WHERE olt_id = '12' AND (board = '16' OR board = 16) AND (port = '7' OR port = 7)", (err, rows) => {
      console.log("ONUs for OLT 12 Board 16 Port 7 in DB:", rows[0].count);
    });
  });
});
