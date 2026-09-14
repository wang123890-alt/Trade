// Excel export without a bundler or an external library: SpreadsheetML
// (Excel's 2003 XML workbook format) is a plain XML document that Excel
// opens natively when given a .xls extension — no zip encoding needed like
// real .xlsx would require, so this stays a single dependency-free file.

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cellXml(value) {
  const type = typeof value === 'number' && Number.isFinite(value) ? 'Number' : 'String';
  return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

/** headers: string[]. rows: (string|number)[][]. note: optional instruction
 * text placed above the header row (merged across all columns) — meant for
 * an outside AI tool reading this file, telling it how to format its reply
 * so the "匯入AI解析" classifier (js/core/aiAnalysisImport.js) can split
 * the reply back into each stock's own field without the per-stock/
 * shared-commentary mixing that a plain data-only export invites. */
function buildExcelXml(sheetName, headers, rows, note) {
  const noteRow = note
    ? `<Row><Cell ss:MergeAcross="${headers.length - 1}"><Data ss:Type="String">${escapeXml(note)}</Data></Cell></Row><Row></Row>`
    : '';
  const headerRow = `<Row>${headers.map(cellXml).join('')}</Row>`;
  const dataRows = rows.map((r) => `<Row>${r.map(cellXml).join('')}</Row>`).join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   ${noteRow}
   ${headerRow}
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function downloadExcel(filename, sheetName, headers, rows, note) {
  const xml = buildExcelXml(sheetName, headers, rows, note);
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { buildExcelXml, downloadExcel };
