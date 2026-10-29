// Crea envíos COD de prueba en Waygo (emulador o sandbox) con POST /v1/shipments, usando catálogos válidos.
// POST /api/waygo/crear  (header x-admin-token)  body opcional: { "cantidad": 6 }
// Cada envío lleva su Idempotency-Key. Los webhooks shipment.created / state_changed los ingieren después.
import { randomUUID } from "node:crypto";
import { exigirTokenAdmin } from "@/lib/admin";
import { registrarEvento } from "@/lib/ingesta/envios";
import { waygo, WaygoError } from "@/lib/waygo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMPRADORES = [
  ["Laura Gómez", "Timiza"],
  ["Santiago Pineda", "Patio Bonito"],
  ["Paola Restrepo", "Bosa Recreo"],
  ["Felipe Ramírez", "Kennedy Central"],
  ["Catalina Rincón", "Castilla"],
  ["Mauricio Díaz", "Venecia"],
  ["Yuli Andrea Cruz", "Marsella"],
  ["Esteban Ocampo", "Olaya"],
];
const TIENDAS = ["Tienda Moda Andina", "Calzado Pacífico", "TecnoBarrio", "Hogar & Cocina Express", "Mascotas Felices", "Deportes Cumbre"];

export async function POST(req: Request) {
  const no = exigirTokenAdmin(req);
  if (no) return no;
  const cuerpo = await req.json().catch(() => ({}));
  const cantidad = Math.min(Math.max(Number(cuerpo?.cantidad) || 6, 1), 12);
  const c = waygo();
  try {
    // Catálogos válidos: bodega (preferir una de la operación), ciudad Bogotá y método efectivo
    const [bodegas, ciudades, metodos] = await Promise.all([
      c.getCatalog("warehouses"),
      c.getLocations({ level: "city", search: "Bogot" }),
      c.getCatalog("payment-methods"),
    ]);
    const bodega = bodegas.find((b) => !b.client_id) || bodegas[0];
    const ciudad = (ciudades.data || [])[0];
    const efectivo = metodos.find((m) => /efectivo|cash/i.test(`${m.code} ${m.name}`));
    if (!bodega || !ciudad) return Response.json({ ok: false, error: "Catálogos incompletos en Waygo (bodega o ciudad)" }, { status: 502 });

    const creados: { id: string; tracking_number: string; order_number?: string }[] = [];
    const sello = Date.now().toString(36).toUpperCase();
    for (let i = 0; i < cantidad; i++) {
      const [nombre, zona] = COMPRADORES[(i + Number(sello.slice(-1).charCodeAt(0))) % COMPRADORES.length];
      const tienda = TIENDAS[i % TIENDAS.length];
      const monto = [89900, 129900, 159900, 189900, 249900, 349900][i % 6];
      const celular = `3${["00", "10", "12", "15", "20", "50"][i % 6]}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
      const r = await c.createShipment(
        {
          warehouse_id: bodega.id,
          is_pickup: false,
          recipient_name: nombre,
          recipient_phone: `+57${celular}`,
          recipient_address: `Cl ${30 + i} Sur # ${68 + i}-${12 + i}, ${zona}, Bogotá`,
          recipient_city_id: ciudad.id,
          payment_type: "cod",
          cod_amount: monto,
          ...(efectivo ? { payment_method_id: efectivo.id } : {}),
          weight: 1 + (i % 3) * 0.5,
          order_number: `TDX-${sello}-${i + 1}`,
          sender_name: tienda,
          notes: "Envío de prueba · demo Torre de Promesa",
        },
        randomUUID(),
      );
      creados.push({ id: r.id, tracking_number: r.tracking_number, order_number: r.order_number });
    }
    await registrarEvento({
      componente: "control",
      herramienta: "waygo.crear_envios",
      entrada: { cantidad },
      resultado: { creados },
      nivel: "ok",
      mensaje: `Se crearon ${creados.length} envíos COD de prueba en Waygo`,
    });
    return Response.json({ ok: true, creados });
  } catch (e) {
    const detalle = e instanceof WaygoError ? { status: e.status, body: e.body } : undefined;
    return Response.json({ ok: false, error: (e as Error).message, detalle }, { status: 502 });
  }
}
