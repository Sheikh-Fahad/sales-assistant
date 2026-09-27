// Paste this into: your Google Sheet > Extensions > Apps Script
// Then Deploy > New deployment > Type: Web app
//   Execute as: Me
//   Who has access: Anyone
// Copy the deployment URL and send it back.

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Orders');
  if (!sheet) {
    sheet = ss.insertSheet('Orders');
    sheet.appendRow(['Timestamp', 'CustomerNumber', 'Product', 'Quantity', 'Address', 'Phone']);
  }

  var data = JSON.parse(e.postData.contents);
  sheet.appendRow([
    data.ts || new Date().toISOString(),
    data.customerNumber || '',
    data.product || '',
    data.quantity || '',
    data.address || '',
    data.phone || ''
  ]);

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
