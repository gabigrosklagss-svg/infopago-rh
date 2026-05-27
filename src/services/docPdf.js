/**
 * Geração de PDFs para documentos (rescisão, 13º, recibo de férias)
 * — reutiliza Puppeteer, mesmo padrão do pdf.js
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/docs');

function fmtBRL(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtData(s) { if (!s) return ''; try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; } }

function renderTemplate(html, data) {
  html = html.replace(/\{\{#each ([\w_]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, block) => {
    const arr = data[key] || [];
    return arr.map(item => {
      let row = block;
      Object.entries(item).forEach(([k, v]) => {
        row = row.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v != null ? String(v) : '');
      });
      return row;
    }).join('');
  });
  html = html.replace(/\{\{([\w_.]+)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => (o ? o[k] : ''), data);
    return val != null ? String(val) : '';
  });
  return html;
}

async function gerarPDFGenerico(templateName, data, subpath, filename) {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const dir = path.join(UPLOADS_DIR, subpath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  const relPath = `uploads/docs/${subpath}/${filename}`;

  const tplPath = path.join(__dirname, `../../templates/${templateName}.html`);
  const tplHTML = fs.readFileSync(tplPath, 'utf8');
  const html = renderTemplate(tplHTML, data);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: filePath, format: 'A4', printBackground: true, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } });
  } finally {
    await browser.close();
  }
  return relPath;
}

module.exports = { gerarPDFGenerico, fmtBRL, fmtData };
