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

/** headers: string[]. rows: (string|number)[][]. */
function buildExcelXml(sheetName, headers, rows) {
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
   ${headerRow}
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function downloadExcel(filename, sheetName, headers, rows) {
  const xml = buildExcelXml(sheetName, headers, rows);
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
