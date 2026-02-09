/*********************************
 * WHL RESULTS SYNC — CHL API
 *********************************/

require("dotenv").config();
const fetch = require("node-fetch");
const { google } = require("googleapis");

/*********************************
 * CONFIG
 *********************************/
const SHEET_NAME = "Results";
const LEAGUE = "whl";

// 🔹 OPTIONAL TEST DATE (YYYY-MM-DD)
// Leave empty for today
const TEST_DATE = "2026-02-10"; // <- change or set to ""

function getRunDate() {
  if (TEST_DATE) {
    console.log("🧪 TEST MODE DATE:", TEST_DATE);
    return TEST_DATE;
  }
  return new Date().toISOString().slice(0, 10);
}

/*********************************
 * GOOGLE AUTH
 *********************************/
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

/*********************************
 * FETCH CHL GAMES
 *********************************/
async function fetchWHLGames(date) {
  const url = `https://cluster.leaguestat.com/feed/?feed=modulekit&view=schedule&key=public&league_id=1&season_id=74&date=${date}`;

  const res = await fetch(url);
  const text = await res.text();

  if (!text.startsWith("{")) {
    console.error("❌ RAW RESPONSE:", text.slice(0, 200));
    throw new Error("Non-JSON response from WHL");
  }

  const json = JSON.parse(text);

  if (!json?.sitekit?.games) return [];

  return json.sitekit.games;
}

/*********************************
 * MAIN
 *********************************/
async function run() {
  try {
    const date = getRunDate();
    console.log("📅 Date:", date);

    const games = await fetchGames(date);

    if (!games.length) {
      console.log("ℹ️ No games found");
      return;
    }

    const rows = games.map(g => {
      const home = g.homeTeam.name;
      const away = g.awayTeam.name;

      let status = "Scheduled";
      if (g.gameStatus === "FINAL") {
        if (g.shootout) status = "Final (SO)";
        else if (g.overtime) status = "Final (OT)";
        else status = "Final";
      }

      return [
        date,
        home,
        away,
        g.homeGoals ?? "",
        g.awayGoals ?? "",
        status,
      ];
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:F`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    console.log(`✅ ${rows.length} games written to sheet`);
  } catch (err) {
    console.error("❌ Sync failed:", err.message);
  } finally {
    console.log("🏁 Finished — exiting");
    process.exit(0);
  }
}

run();
