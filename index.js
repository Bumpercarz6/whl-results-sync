/*********************************
 * WHL RESULTS SYNC (SCHEDULE + FINAL)
 *********************************/
require("dotenv").config();
const fetch = require("node-fetch");
const { google } = require("googleapis");

/*********************************
 * CONFIG
 *********************************/
const SHEET_NAME = "Results";
const TIMEZONE = "America/Edmonton";

/*********************************
 * GOOGLE AUTH
 *********************************/
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

/*********************************
 * HELPERS
 *********************************/
function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function buildKey(date, home, away) {
  return `${date}|${home}|${away}`;
}

/*********************************
 * FETCH WHL DATA (SAFE)
 *********************************/
async function fetchWHLGames(date) {
  const url = `https://lscluster.hockeytech.com/feed/?feed=statviewfeed&view=schedule&date=${date}&league_id=1&key=public`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json"
    }
  });

  const text = await res.text();

  if (!text.startsWith("{")) {
    console.error("❌ Non-JSON response from WHL");
    return [];
  }

  const data = JSON.parse(text);
  return data?.schedule ?? [];
}

/*********************************
 * MAIN
 *********************************/
async function run() {
  try {
    const date = todayISO();
    console.log("📅 Date:", date);

    const games = await fetchWHLGames(date);
    if (!games.length) {
      console.log("ℹ️ No games found");
      return;
    }

    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:F`
    });

    const rows = sheetRes.data.values || [];
    const rowMap = new Map();

    rows.forEach((r, i) => {
      const key = buildKey(r[0], r[1], r[2]);
      rowMap.set(key, i + 2);
    });

    const updates = [];
    const inserts = [];

    for (const g of games) {
      const home = g.home_team_name;
      const away = g.visiting_team_name;

      const homeScore = g.home_goal_count ?? "";
      const awayScore = g.visiting_goal_count ?? "";

      let status = "Scheduled";
      if (g.game_status === "Final") {
        status = "Final";
        if (g.overtime === "1") status = "Final (OT)";
        if (g.shootout === "1") status = "Final (SO)";
      }

      const key = buildKey(date, home, away);

      if (rowMap.has(key)) {
        const rowNum = rowMap.get(key);
        updates.push({
          range: `${SHEET_NAME}!D${rowNum}:F${rowNum}`,
          values: [[homeScore, awayScore, status]]
        });
      } else {
        inserts.push([
          date,
          home,
          away,
          homeScore,
          awayScore,
          status
        ]);
      }
    }

    for (const u of updates) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: u.range,
        valueInputOption: "RAW",
        requestBody: { values: u.values }
      });
    }

    if (inserts.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:F`,
        valueInputOption: "RAW",
        requestBody: { values: inserts }
      });
    }

    console.log(`✅ Updated: ${updates.length}`);
    console.log(`➕ Inserted: ${inserts.length}`);

  } catch (err) {
    console.error("❌ Sync failed:", err);
  } finally {
    console.log("🛑 Finished — exiting");
    process.exit(0);
  }
}

run();
