// Générateur .xlsx minimal, sans dépendance : un classeur mono-feuille à partir
// d'un tableau de lignes (chaînes). Toutes les cellules sont des chaînes inline
// (`inlineStr`), ce qui évite la table de chaînes partagées. Le fichier .xlsx est
// une archive ZIP « stored » (sans compression), construite à la main.

type Row = (string | number | null | undefined)[];

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Lettre de colonne Excel (0 → A, 26 → AA…).
function colLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function sheetXml(rows: Row[]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((val, c) => {
          const ref = `${colLetter(c)}${r + 1}`;
          const text = val == null ? "" : String(val);
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

/* ---------------- ZIP (méthode "stored", sans compression) ---------------- */

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc >>> 0) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function zip(entries: ZipEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) =>
    new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const concat = (arrs: Uint8Array[]) => {
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const a of arrs) {
      out.set(a, p);
      p += a.length;
    }
    return out;
  };

  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = concat([
      u32(0x04034b50), // signature
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method 0 = stored
      u16(0), // mod time
      u16(0), // mod date
      u32(crc),
      u32(size), // compressed size
      u32(size), // uncompressed size
      u16(name.length),
      u16(0), // extra len
      name,
      e.data,
    ]);
    chunks.push(local);

    central.push(
      concat([
        u32(0x02014b50), // central dir signature
        u16(20), // version made by
        u16(20), // version needed
        u16(0), // flags
        u16(0), // method
        u16(0), // time
        u16(0), // date
        u32(crc),
        u32(size),
        u32(size),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk number
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset), // local header offset
        name,
      ]),
    );
    offset += local.length;
  }

  const centralBlob = concat(central);
  const end = concat([
    u32(0x06054b50), // end of central dir signature
    u16(0), // disk
    u16(0), // cd start disk
    u16(entries.length),
    u16(entries.length),
    u32(centralBlob.length),
    u32(offset),
    u16(0), // comment len
  ]);

  return concat([...chunks, centralBlob, end]);
}

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * Construit un classeur .xlsx mono-feuille et déclenche son téléchargement.
 * @param filename nom du fichier (ex. "invites.xlsx")
 * @param sheetName nom de l'onglet
 * @param rows lignes (la 1re sert d'en-tête)
 */
export function downloadXlsx(filename: string, sheetName: string, rows: Row[]): void {
  const safeSheet = xmlEscape(sheetName).slice(0, 31) || "Feuille1";
  const files: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheetXml(rows)) },
  ];

  const blob = new Blob([zip(files) as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
