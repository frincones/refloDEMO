"use client";
// Lector mínimo de Server-Sent Events sobre un fetch (POST /api/chat).

export type EventoSSE = { evento: string; datos: unknown };

export async function* leerSSE(res: Response): AsyncGenerator<EventoSSE> {
  const lector = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await lector.read();
    if (value) buffer += value;
    let corte: number;
    // Los eventos se separan con una línea en blanco (\n\n o \r\n\r\n)
    while ((corte = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const bloque = buffer.slice(0, corte);
      buffer = buffer.slice(corte).replace(/^\r?\n\r?\n/, "");
      const ev = parsear(bloque);
      if (ev) yield ev;
    }
    if (done) {
      const ev = parsear(buffer);
      if (ev) yield ev;
      return;
    }
  }
}

function parsear(bloque: string): EventoSSE | null {
  let evento = "message";
  const datos: string[] = [];
  for (const linea of bloque.split(/\r?\n/)) {
    if (!linea || linea.startsWith(":")) continue;
    const i = linea.indexOf(":");
    const campo = i < 0 ? linea : linea.slice(0, i);
    const valor = i < 0 ? "" : linea.slice(i + 1).replace(/^ /, "");
    if (campo === "event") evento = valor;
    else if (campo === "data") datos.push(valor);
  }
  if (!datos.length) return null;
  const crudo = datos.join("\n");
  try {
    return { evento, datos: JSON.parse(crudo) };
  } catch {
    return { evento, datos: crudo };
  }
}
