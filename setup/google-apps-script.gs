/**
 * Mystoria — launch-notification signup backend
 * ------------------------------------------------------------
 * This file is NOT part of the my-storia.com website. It runs on
 * Google Apps Script and appends signup form submissions to a
 * Google Sheet.
 *
 * SETUP
 *  1. Create a Google Sheet to hold the signups. Copy its ID from
 *     the URL — the long string between /d/ and /edit:
 *        https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit
 *  2. Go to https://script.google.com → New project.
 *     Delete the starter code and paste this whole file in.
 *  3. Set SHEET_ID below to the ID you copied.
 *  4. Click Deploy → New deployment → gear icon → Web app.
 *        - Description:    Mystoria notify signup
 *        - Execute as:     Me
 *        - Who has access: Anyone
 *     Click Deploy and authorize when prompted.
 *  5. Copy the "Web app" URL it gives you and paste it into
 *     js/main.js, replacing the ENDPOINT placeholder.
 *  6. IMPORTANT: any time you edit this script, you must create a
 *     new version — Deploy → Manage deployments → edit (pencil) →
 *     Version: New version → Deploy. Otherwise the live URL keeps
 *     running the old code.
 *
 * The deployed Web app URL is public by design (the browser has to
 * post to it). This script only ever writes to the Sheet and only
 * accepts a valid-looking email, so there are no secrets to leak.
 */

const SHEET_ID = 'REPLACE_WITH_YOUR_SHEET_ID';
const SHEET_NAME = 'Signups';

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    const name = String(params.name || '').trim();
    const email = String(params.email || '').trim().toLowerCase();
    const research = String(params.research || '').trim().toLowerCase() === 'yes' ? 'Yes' : 'No';
    const source = String(params.source || '').trim();

    // Basic email shape check — full validation isn't possible server-side.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, error: 'invalid_email' });
    }

    // Lock so two simultaneous submissions can't both skip the dedupe check.
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSheet();
      const lastRow = sheet.getLastRow();

      // Email lives in column 2 — see the header row in getSheet().
      let isDuplicate = false;
      if (lastRow >= 2) {
        const existing = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
        isDuplicate = existing.some(function (row) {
          return String(row[0]).trim().toLowerCase() === email;
        });
      }

      if (!isDuplicate) {
        sheet.appendRow([name, email, research, source, new Date()]);
      }
    } finally {
      lock.releaseLock();
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// Lets you open the Web app URL in a browser to confirm it's live.
function doGet() {
  return json({ ok: true, service: 'mystoria-notify' });
}

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Name', 'Email', 'Research interest', 'Source', 'Signed up']);
  }
  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
