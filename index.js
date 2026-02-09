/*********************************
 * WHL RESULTS SYNC (SAFE PROJECT)
 *********************************/
import fetch from "node-fetch";
import { google } from "googleapis";

/*********************************
 * CONFIG
 *********************************/
const SHEET_NAME = "Results";
const TIMEZONE = "America/Edmonton";

/*********************************
 * DATE HELPERS
 *********************************/
function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

function nowMountainHour() {
  return Number(
    new Date().toLocaleString("en-US", {
      timeZone: TIMEZONE,
      hour: "numeric",
      hour12: false
    })
  );
}

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
 * FETCH WHL GAMES
 *********************************/
async function fetchWHLGames(date) {
  const url = `https://lscluster.hockeytech.com/feed/?feed=statviewfeed&view=schedule&date=${date}&league_id=1&key=public`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.schedule || [];
}

/*********************************
 * LOAD EXISTING RESULTS
 *********************************/
async function loadExistingRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:F`
  });

  return res.data.values || [];
}

/*********************************
 * WRITE RESULTS
 *********************************/
async function writeRows(rows) {
  if (!rows.length) return;

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

/*********************************
 * MAIN LOGIC
 *********************************/
async function run() {
  const date = todayISO();
  const hour = nowMountainHour();

  console.log("📅 Date:", date);
  console.log("⏰ Mountain Hour:", hour);

  const games = await fetchWHLGames(date);
  if (!games.length) {
    console.log("ℹ️ No games today");
    return;
  }

  const existing = await loadExistingRows();
  const existingKeys = new Set(
    existing.map(r => `${r[0]}|${r[1]}|${r[2]}`)
  );

  const rowsToInsert = [];

  for (const g of games) {
    const home = g.home_team_name;
    const away = g.visiting_team_name;
    const key = `${date}|${home}|${away}`;

    if (existingKeys.has(key)) continue;

    let status = "Scheduled";
    let homeScore = "";
    let awayScore = "";

    if (g.game_status === "Final") {
      homeScore = g.home_goal_count;
      awayScore = g.visiting_goal_count;
      status = g.overtime === "1" ? "OT" : g.shootout === "1" ? "SO" : "Final";
    }

    rowsToInsert.push([
      date,
      home,
      away,
      homeScore,
      awayScore,
      status
    ]);
  }

  await writeRows(rowsToInsert);
  console.log(`✅ Inserted ${rowsToInsert.length} rows`);
}

/*********************************
 * RUN
 *********************************/
run()
  .then(() => console.log("🏁 Sync complete"))
  .catch(err => {
    console.error("❌ Sync error:", err);
    process.exit(1);
  });
