import { defEstado, nivelRiesgo, RIESGO } from "@/lib/ui/estados";
import { num } from "@/lib/ui/formato";

export function ChipEstado({ estado, detalle }: { estado: string; detalle?: string }) {
  const d = defEstado(estado);
  return (
    <span className={`chip ${d.cls}`} title={estado}>
      {d.label + (detalle ? " · " + detalle : "")}
    </span>
  );
}

export function ChipRiesgo({ riesgo }: { riesgo: number | string | null | undefined }) {
  const n = nivelRiesgo(riesgo);
  if (!n) return <span className="code" title="El analista de riesgo aún no lo calcula (Control → Preparar buffer)">—</span>;
  const [cls, lab] = RIESGO[n];
  return (
    <span className={`chip risk-chip ${cls}`} title={`Riesgo ${num(riesgo)?.toFixed(2)}`}>
      {lab}
    </span>
  );
}

/** Barra de confianza de la tabla (0–1 o 0–100). */
export function Confianza({ valor, alinear = "end" }: { valor: number | string | null | undefined; alinear?: "end" | "start" }) {
  let n = num(valor);
  if (n === null) return <span className="code">n/a</span>;
  if (n <= 1) n = n * 100;
  const v = Math.round(n);
  return (
    <div className="conf" style={alinear === "start" ? { justifyContent: "flex-start" } : undefined}>
      <span className="num">{v} %</span>
      <span className="bar">
        <i className={v < 50 ? "lo" : v < 75 ? "mid" : ""} style={{ width: `${v}%` }} />
      </span>
    </div>
  );
}

export function EtiquetaDemo({ texto = "Demo · datos de prueba" }: { texto?: string }) {
  return <span className="sample-tag">{texto}</span>;
}
