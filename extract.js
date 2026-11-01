// Louhii tekstisisällön ladatuista tiedostoista hakua varten.
// Tuetut: PDF, Word (.docx, .doc), Excel (.xlsx).
// Kuvista ja legacy .xls -tiedostoista ei louhita tekstiä (kts. README).
const fs = require('fs');

// Tallennettavan tekstin yläraja, ettei tietokanta paisu suurista tiedostoista.
const MAX_TEXT = 1_000_000; // ~1 Mt merkkejä

async function extractText(filePath, mimetype) {
  try {
    if (mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      // Kopioidaan omaan puskuriin (byteOffset 0): Node.js poolaa pienet
      // tiedostot jaettuun ArrayBufferiin, jolloin pdf.js lukee väärästä
      // kohdasta ja pienten PDF:ien louhinta epäonnistuisi.
      const data = new Uint8Array(fs.readFileSync(filePath));
      const parsed = await pdfParse(data);
      return clean(parsed.text);
    }
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ path: filePath });
      return clean(r.value);
    }
    if (mimetype === 'application/msword') {
      const WordExtractor = require('word-extractor');
      const doc = await new WordExtractor().extract(filePath);
      return clean(doc.getBody());
    }
    if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      const parts = [];
      wb.eachSheet((sheet) => {
        parts.push(sheet.name);
        sheet.eachRow((row) => {
          const vals = row.values.slice(1).map(cellText).filter(Boolean);
          if (vals.length) parts.push(vals.join(' '));
        });
      });
      return clean(parts.join('\n'));
    }
  } catch (e) {
    console.error('Tekstin louhinta epäonnistui:', filePath, '-', e.message);
  }
  return '';
}

// Excel-solu voi olla merkkijono, luku, päivä tai rikas teksti/kaava-objekti.
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text) return v.text;
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.hyperlink) return v.hyperlink;
    return '';
  }
  return String(v);
}

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

module.exports = { extractText };
