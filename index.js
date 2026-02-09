/*************************
 * WHL RESULTS SYNC
 *************************/

require("dotenv").config();
const fetch = require("node-fetch");
const { google } = require("googleapis");

/*************************
 * CONFIG
 *************************/
const SHEET_NAME = "Results";
const TIMEZONE = "America/Edmonton";

// Optional test date (YYYY-MM-DD)
// Leave empty in production
const TEST_DATE = process.env.TEST_DATE || null;

/*************************
 * DATE HANDLING
 *************************/
function getRunDate() {
  if (TEST_DATE) {
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
    `https://lscluster.hockeytech.com/feed/` +
    `?feed=statviewfeed` +
    `&view=scoreboard` +
    `&season=2025` +
    `&date=${date}` +
    `&league_id=1` +
    `&key=public`;

  const res = await fetch(url);
  const text = await res.text();

  // Guard: must be JSON
  if (!text.trim().startsWith("{")) {
    throw new Error("Non-JSON response from WHL");
  }

  const json = JSON.parse(text);
  return json?.scoreboard?.games || [];
}

/*************************
 * MAIN
 *************************/
async function run() {
  try {
    const date = getRunDate();
    console.log("📅 Date:", date);

    const games = await fetchWHLGames(date);

    if (!games.length) {
      console.log("ℹ️ No games found");
      return;
    }

    const rows = games.map(g => {
      const home = g.home_team_name;
      const away = g.visiting_team_name;

      const homeScore = Number(g.home_goal_count || 0);
      const awayScore = Number(g.visiting_goal_count || 0);

      let status = "Scheduled";

      if (g.game_status === "Final") {
        status = "Final";
        if (g.overtime === "1") status = "OT";
        if (g.shootout === "1") status = "SO";
      }

      return [
        date,
        home,
        away,
        homeScore,
        awayScore,
        status
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:F`,
      valueInputOption: "RAW",
      requestBody: { values: rows }
    });

    console.log(`✅ ${rows.length} games written`);

  } catch (err) {
    console.error("❌ Sync failed:", err.message);
  } finally {
    console.log("🏁 Finished – exiting");
    process.exit(0);
  }
}

run();
