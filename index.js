/************************************
 * WHL RESULTS SYNC (SAFE + FINAL)
 ************************************/
require("dotenv").config();
const fetch = require("node-fetch");
const { google } = require("googleapis");

/************************************
 * CONFIG
 ************************************/
const SHEET_NAME = "Results";
const TIMEZONE = "America/Edmonton";

/************************************
 * DATE HANDLING (TEST MODE SAFE)
 ************************************/
function getRunDate() {
  if (process.env.TEST_DATE) {
    console.log("🧪 TEST MODE DATE:", process.env.TEST_DATE);
    return process.env.TEST_DATE;
  }

  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );

  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

/************************************
 * GOOGLE AUTH
 ************************************/
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

/************************************
 * FETCH WHL GAMES
 ************************************/
async function fetchWHLGames(date) {
  const url =
    `https://lscluster.hockeytech.com/feed/?feed=schedule&league_id=1&key=public&date=${date}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  const text = await res.text();

  if (!text.trim().startsWith("{")) {
    console.error("❌ RAW RESPONSE:", text.slice(0, 200));
    throw new Error("Non-JSON response from WHL");
  }

  const json = JSON.parse(text);
  return json?.games || [];
}

/************************************
 * MAIN
 ************************************/
async function run() {
  try {
    const date = getRunDate();
    console.log("📅 Date:", date);

    const games = await fetchWHLGames(date);

    if (!games.length) {
      console.log("ℹ️ No games found");
      return;
    }

    /************************************
     * READ EXISTING RESULTS
     ************************************/
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:F`,
    });

    const rows = sheetRes.data.values || [];
    const rowMap = new Map();

    rows.forEach((row, i) => {
      const [d, away, home] = row;
      if (d && away && home) {
        rowMap.set(`${d}|${away}|${home}`, i + 2);
      }
    });

    /************************************
     * PROCESS GAMES
     ************************************/
    for (const g of games) {
      const away = g.visiting_team_name;
      const home = g.home_team_name;

      const awayScore = g.visiting_team_score ?? "";
      const homeScore = g.home_team_score ?? "";

      let status = "Scheduled";
      if (g.game_state === "FINAL") {
        status = "Final";
        if (g.overtime === "1") status = "Final (OT)";
        if (g.shootout === "1") status = "Final (SO)";
      }

      const key = `${date}|${away}|${home}`;
      const existingRow = rowMap.get(key);

      // INSERT
      if (!existingRow) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: `${SHEET_NAME}!A:F`,
          valueInputOption: "RAW",
          requestBody: {
            values: [[date, away, home, "", "", "Scheduled"]],
          },
        });

        console.log(`➕ Added: ${away} @ ${home}`);
      }

      // UPDATE
      else if (status !== "Scheduled") {
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: `${SHEET_NAME}!D${existingRow}:F${existingRow}`,
          valueInputOption: "RAW",
          requestBody: {
            values: [[awayScore, homeScore, status]],
          },
        });

        console.log(`🔁 Updated: ${away} @ ${home} → ${status}`);
      }
    }

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
  } finally {
    console.log("🏁 Finished — exiting");
    process.exit(0);
  }
}

run();
