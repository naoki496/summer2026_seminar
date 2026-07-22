// csv.js
(function () {
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = "";
      } else if (ch === '\n') {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }

    if (field.length || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every(v => String(v).trim() === "")) rows.pop();
    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const header = rows[0].map(v => String(v).trim());
    if (header[0] && header[0].charCodeAt(0) === 0xFEFF) header[0] = header[0].slice(1);
    return rows.slice(1).filter(row => row.some(v => String(v).trim() !== "")).map(row => {
      const obj = {};
      header.forEach((key, i) => { obj[key] = String(row[i] ?? "").trim(); });
      return obj;
    });
  }

  async function load(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`CSVの取得に失敗しました: ${response.status}`);
    return rowsToObjects(parseCSV(await response.text()));
  }

  window.CSVUtil = { load };
})();
