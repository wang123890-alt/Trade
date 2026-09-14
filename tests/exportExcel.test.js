// Plain Node test runner. Run with: node tests/exportExcel.test.js
import assert from 'node:assert/strict';
import { buildExcelXml } from '../js/utils/exportExcel.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.stack}`);
  }
}

test('produces a well-formed SpreadsheetML document with header + data rows', () => {
  const xml = buildExcelXml('持股', ['代號', '股數'], [['2330', 1000], ['2886', 500]]);
  assert.ok(xml.startsWith('<?xml version="1.0"?>'));
  assert.ok(xml.includes('<?mso-application progid="Excel.Sheet"?>'));
  assert.ok(xml.includes('ss:Name="持股"'));
  assert.match(xml, /<Data ss:Type="String">代號<\/Data>/);
  assert.match(xml, /<Data ss:Type="String">2330<\/Data>/);
  assert.match(xml, /<Data ss:Type="Number">1000<\/Data>/);
});

test('escapes XML special characters in cell values', () => {
  const xml = buildExcelXml('sheet', ['備註'], [['A & B < C > D']]);
  assert.ok(xml.includes('A &amp; B &lt; C &gt; D'));
  assert.ok(!xml.includes('A & B'));
});

test('empty rows still produce a valid header-only table', () => {
  const xml = buildExcelXml('sheet', ['代號'], []);
  assert.match(xml, /<Data ss:Type="String">代號<\/Data>/);
});

test('an optional note is placed above the header row, merged across all columns', () => {
  const xml = buildExcelXml('持股', ['代號', '股數'], [['2330', 1000]], '請分開分析每一列');
  const noteIndex = xml.indexOf('請分開分析每一列');
  const headerIndex = xml.indexOf('代號');
  assert.ok(noteIndex > -1);
  assert.ok(noteIndex < headerIndex); // note row comes before the header row
  assert.match(xml, /ss:MergeAcross="1"/); // spans both columns (headers.length - 1)
});

test('omitting the note produces no note row at all', () => {
  const xml = buildExcelXml('持股', ['代號'], [['2330']]);
  assert.ok(!xml.includes('MergeAcross'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
