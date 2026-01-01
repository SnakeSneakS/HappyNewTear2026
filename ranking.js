const SHEET_NAME = "Ranking";
const MAX_SCORE = 10000000; // 上限


function authorize() {
  SpreadsheetApp.getActiveSpreadsheet().getSheets();
}


function doPost(e) {
  try {
    const sheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const data = JSON.parse(e.postData.contents);

    const name = data.name;
    const score = Number(data.score);

    // バリデーション
    if (!name || isNaN(score) || score < 0 || score > MAX_SCORE) {
      return output({ result: "error", message: "invalid parameters" });
    }

    const values = sheet.getDataRange().getValues();

    // 既存ユーザー検索
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === name) {
        const oldScore = Number(values[i][1]);

        // スコアが上がった時だけ更新
        if (score > oldScore) {
          sheet.getRange(i + 1, 2).setValue(score);
          sheet.getRange(i + 1, 3).setValue(new Date());
          return output({
            result: "updated",
            name,
            oldScore,
            newScore: score,
          });
        } else {
          return output({
            result: "ignored",
            name,
            oldScore,
            attemptedScore: score,
          });
        }
      }
    }

    // 新規ユーザー
    sheet.appendRow([name, score, new Date()]);
    return output({
      result: "created",
      name,
      score,
    });
  } catch (err) {
    return output({
      result: "error",
      message: err.toString(),
    });
  }
}

function doGet(e) {
  const sheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();

  const ranking = values
    .slice(1)
    .map((r) => ({ name: r[0], score: r[1] }))
    .sort((a, b) => b.score - a.score);

  return output(ranking);
}

function output(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}
