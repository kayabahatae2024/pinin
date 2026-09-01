/**
 * ダッシュボード用データAPI
 * ------------------------------------------------------------
 * このスクリプトは「年間データ(元データ)」シートの A7:AN を読み取り、
 * JSON形式でWebページに返すだけの役割です。
 * スプレッドシート自体は一切変更しません（読み取り専用）。
 *
 * ▼セットアップ手順
 * 1. Apps Script エディタで新しいファイル「DashboardApi」を追加し、この内容を貼り付け
 * 2. 上部メニュー「デプロイ」→「新しいデプロイ」
 *      種類: ウェブアプリ
 *      次のユーザーとして実行: 自分
 *      アクセスできるユーザー: 全員
 * 3. デプロイ後に発行される URL（.../exec で終わるもの）を
 *    app.js の GAS_URL に貼り付ける
 * 4. スプレッドシートの内容を変更した後は、再デプロイ不要。
 *    Webページの「最新データを取得」ボタンを押すだけで反映されます。
 */
// ▼このスプレッドシートID・シート名は指定のものを設定済みです
const SPREADSHEET_ID = '1RJ-L80c7IYeRRlK2B44J_25qw9Z50of__H3n8Z5dsvk';
const SHEET_NAME = '年間データ(元データ)';
function doGet(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const tz = Session.getScriptTimeZone();
  const records = [];
  if (lastRow >= 7) {
    // A7:AN(最終行) をまとめて取得（列: A=1 ... AN=40）
    const range = sheet.getRange(7, 1, lastRow - 6, 40);
    const values = range.getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const shop = row[2];   // C 店舗名
      // 店舗名が空の行はデータ末尾とみなしスキップ
      if (shop === '' || shop === null) continue;
      const dateVal = row[1]; // B 日付
      let dateStr = '';
      if (dateVal instanceof Date) {
        dateStr = Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd');
      } else if (dateVal) {
        dateStr = String(dateVal);
      }
      records.push({
        date: dateStr,                         // B 日付
        managerName: row[5],                   // F 店長名
        shop: shop,                            // C 店舗名
        brand: row[3],                         // D 屋号
        pref: row[4],                          // E 都道府県名
        raiten: row[6],                        // G 来店要件
        sales: Number(row[17]) || 0,           // R 見込み利益
        seiyaku: String(row[19]) === '成約',    // T 成約フラグ
        chihou: row[32],                       // AG 地方
        chukai: row[33],                       // AH 仲介
        ngShop: row[34],                       // AI NG店舗
        week: row[35],                         // AJ 週（月の何週目か）
        shopNote: row[36],                     // AK 店舗備考（NG理由等）
        shopId: row[37],                       // AL 店舗ID
        month: row[38]                         // AM 月
      });
    }
  }
  const payload = {
    updatedAt: new Date().toISOString(),
    count: records.length,
    records: records
  };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
