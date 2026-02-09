/*************************
 * WHL RESULTS SYNC
 * Safe, Cron-Friendly
 *************************/

require("dotenv").config();
const fetch = require("node-fetch");
const { google } = require("googleapis");

/*************************
 * CONFIG
 *************************/
const SHEET_NAME = "Results";
const TIMEZONE = "America/Edmonton";

// OPTIONAL test date: YYYY-MM-DD
const TEST_DATE = process.env.TEST_DATE || null;

/*************************
 * DATE HELPERS
 *************************/
function getRunDate() {
  if (2026-02-10) {
    console.log("🧪 TEST MODE DATE:", TEST_DATE);
    return TEST_DATE;
  }

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/*************************
 * GOOGLE AUTH
 *************************/
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

/*************************
 * FETCH WHL GAMES
 *************************/
async function fetchWHLGames(date) {
  const url =
    `https://lscluster.hockeytech.com/feed/?feed=statviewfeed` +
    `&view=schedule&date=${date}&league_id=1&key=public`;

  const res = await fetch(url);
  const text = await res.text();

  // WHL sometimes returns HTML instead of JSON
  if (!text.trim().startsWith("{")) {
    console.error("❌ Non-JSON response from WHL");
    return [];
  }

  const data = JSON.parse(text);
  return data?.schedule ?? [];
}

/*************************
 * MAIN RUN
 *************************/
async function run() {
  try {
    const date = getRunDate();
    console.log("📅 Date:", date);

    const games = await fetchWHLGames(date);

    if (!games.length) {
      console.log("ℹ️ No games found");
      process.exit(0);
    }

    const rows = games.map(g => {
      const home = g.home_team_name;
      const away = g.visiting_team_name;
      const homeScore = g.home_goal_count ?? "";
      const awayScore = g.visiting_goal_count ?? "";

      let status = "Scheduled";
      if (g.game_status === "Final") {
        if (g.game_decided_in === "OT") status = "Final (OT)";
        else if (g.game_decided_in === "SO") status = "Final (SO)";
        else status = "Final";
      }

      return [date, away, home, awayScore, homeScore, status];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:F`,
      valueInputOption: "RAW",
      requestBody: { values: rows }
    });

    console.log(`✅ ${rows.length} games written`);
    process.exit(0);

  } catch (err) {
    console.error("❌ Sync failed:", err);
    process.exit(1);
  }
}

run();
