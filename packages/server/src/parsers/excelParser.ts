import ExcelJS from 'exceljs';
import type { ImportItem } from '@m3u8-preview/shared';
import { AppError } from '../middleware/errorHandler.js';

function resolveCellValue(val: ExcelJS.CellValue): string | number | boolean | null {
  if (val == null) return null;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
  if (val instanceof Date) return val.getFullYear();
  if (typeof val === 'object') {
    if ('richText' in val) return val.richText.map((r) => r.text).join('');
    if ('text' in val) return (val as ExcelJS.CellHyperlinkValue).text;
    if ('result' in val) {
      const r = (val as ExcelJS.CellFormulaValue).result;
      if (r != null && typeof r !== 'object') return r;
      return null;
    }
    if ('error' in val) return null;
  }
  return String(val);
}

function str(val: unknown): string {
  if (val == null) return '';
  return String(val);
}

export async function parseExcel(buffer: Buffer): Promise<ImportItem[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer);
  } catch {
    throw new AppError('无法解析 Excel 文件，请检查文件格式', 400);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const v = resolveCellValue(cell.value);
    headers[colNumber] = v != null ? String(v).trim() : '';
  });

  const results: ImportItem[] = [];

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const obj: Record<string, string | number | boolean | null> = {};
    let hasValue = false;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) {
        obj[key] = resolveCellValue(cell.value);
        hasValue = true;
      }
    });

    if (!hasValue) continue;

    const yearRaw = obj.year ?? obj['年份'] ?? obj.Year;
    const tagsRaw = obj.tags ?? obj['标签'] ?? obj.Tags;

    results.push({
      title: str(obj.title ?? obj['标题'] ?? obj.Title),
      m3u8Url: str(obj.m3u8Url ?? obj.m3u8_url ?? obj.url ?? obj.URL ?? obj['链接']),
      posterUrl: (obj.posterUrl ?? obj.poster_url ?? obj.poster ?? obj['海报']) != null
        ? str(obj.posterUrl ?? obj.poster_url ?? obj.poster ?? obj['海报'])
        : undefined,
      description: (obj.description ?? obj['描述'] ?? obj.Description) != null
        ? str(obj.description ?? obj['描述'] ?? obj.Description)
        : undefined,
      year: yearRaw != null ? parseInt(String(yearRaw)) || undefined : undefined,
      artist: (obj.artist ?? obj['作者'] ?? obj['演员'] ?? obj.Artist) != null
        ? str(obj.artist ?? obj['作者'] ?? obj['演员'] ?? obj.Artist)
        : undefined,
      categoryName: (obj.category ?? obj['分类'] ?? obj.Category) != null
        ? str(obj.category ?? obj['分类'] ?? obj.Category)
        : undefined,
      tagNames: tagsRaw
        ? String(tagsRaw).split(',').map((t: string) => t.trim()).filter(Boolean)
        : undefined,
    });
  }

  return results;
}
