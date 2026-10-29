import "server-only";

// Generador mínimo de PDF (sin dependencias) para la guía 4×6" (288×432 pt).
// Texto en Helvetica con WinAnsiEncoding (latin-1: admite tildes y ñ) y un "código de barras"
// dibujado con rectángulos a partir del número de guía.

export type DatosGuia = {
  tracking: string;
  orden: string;
  remitente: string;
  telefonoRemitente?: string;
  destinatario: string;
  telefono?: string;
  direccion: string;
  direccion2?: string;
  referencia?: string;
  piezas: number;
  peso?: number;
  cobrar?: number;
  servicio?: string;
  estado?: string;
  notas?: string;
};

function esc(t: string): string {
  // Solo latin-1; lo demás se reemplaza por "?"
  const latin = Array.from(t)
    .map((c) => (c.charCodeAt(0) <= 255 ? c : "?"))
    .join("");
  return latin.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function cop(n: number): string {
  return "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function barras(texto: string, x: number, y: number, ancho: number, alto: number): string {
  // Patrón determinista: cada carácter → 11 módulos (estilo Code 128, solo visual)
  const bits: number[] = [1, 1, 0, 1, 0, 0, 1, 1, 0, 0];
  for (const c of texto) {
    const v = c.charCodeAt(0) * 7 + 13;
    for (let i = 0; i < 11; i++) bits.push((v >> i) & 1 || i % 4 === 0 ? 1 : 0);
  }
  bits.push(1, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1);
  const m = ancho / bits.length;
  let ops = "";
  bits.forEach((b, i) => {
    if (b) ops += `${(x + i * m).toFixed(2)} ${y} ${m.toFixed(2)} ${alto} re f\n`;
  });
  return ops;
}

export function pdfGuia(d: DatosGuia): Uint8Array {
  const lineas: string[] = [];
  const texto = (x: number, y: number, tam: number, t: string, negrita = false) =>
    lineas.push(`BT /${negrita ? "F2" : "F1"} ${tam} Tf ${x} ${y} Td (${esc(t)}) Tj ET`);

  // Marco y encabezado
  lineas.push("0.5 w 8 8 272 416 re S");
  texto(18, 404, 14, "Waygo · guía de envío", true);
  texto(18, 390, 8, "Emulador TDX para el demo de Reflo · no es una guía real");
  texto(18, 366, 18, d.tracking, true);
  lineas.push(barras(d.tracking, 18, 318, 252, 40));
  texto(18, 304, 9, `Pedido: ${d.orden}${d.servicio ? `   ·   Servicio: ${d.servicio}` : ""}`);
  lineas.push("18 296 m 270 296 l S");

  texto(18, 282, 8, "REMITENTE", true);
  texto(18, 270, 10, d.remitente);
  if (d.telefonoRemitente) texto(18, 258, 9, `Tel. ${d.telefonoRemitente}`);
  lineas.push("18 250 m 270 250 l S");

  texto(18, 236, 8, "DESTINATARIO", true);
  texto(18, 222, 12, d.destinatario, true);
  if (d.telefono) texto(18, 208, 10, `Tel. ${d.telefono}`);
  texto(18, 194, 9, d.direccion.slice(0, 56));
  if (d.direccion.length > 56) texto(18, 183, 9, d.direccion.slice(56, 112));
  if (d.direccion2) texto(18, 172, 9, d.direccion2.slice(0, 56));
  if (d.referencia) texto(18, 161, 8, `Ref.: ${d.referencia.slice(0, 60)}`);
  lineas.push("18 150 m 270 150 l S");

  texto(18, 134, 9, `Piezas: ${d.piezas}${d.peso ? `   ·   Peso: ${d.peso} kg` : ""}`);
  if (d.estado) texto(18, 120, 9, `Estado actual: ${d.estado}`);
  if (d.cobrar && d.cobrar > 0) {
    lineas.push("18 70 252 40 re S");
    texto(26, 96, 9, "COBRAR CONTRAENTREGA", true);
    texto(26, 78, 16, cop(d.cobrar), true);
  } else {
    texto(18, 96, 10, "PREPAGADO · no cobrar", true);
  }
  if (d.notas) texto(18, 52, 8, `Notas: ${d.notas.slice(0, 200).slice(0, 62)}`);
  texto(18, 20, 7, `Generado ${new Date().toISOString()}`);

  const contenido = lineas.join("\n");
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(contenido, "latin1")} >>\nstream\n${contenido}\nendstream`,
  ];
  let salida = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(Buffer.byteLength(salida, "latin1"));
    salida += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(salida, "latin1");
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) salida += `${String(off).padStart(10, "0")} 00000 n \n`;
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(salida, "latin1"));
}
