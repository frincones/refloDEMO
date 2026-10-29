import "server-only";

/** Lee una variable de entorno del servidor; lanza un error claro si falta. */
export function env(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

/** Variable opcional con valor por defecto. */
export function envOpcional(nombre: string, porDefecto = ""): string {
  return process.env[nombre] || porDefecto;
}
