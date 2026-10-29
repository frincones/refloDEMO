-- =====================================================================
-- 0003_agente.sql · Bloque 2A (workers + agente de contacto)
-- Idempotente: se puede volver a aplicar.
-- =====================================================================

-- Estado del buffer mientras corre la cadencia (plantilla enviada, sin intención todavía).
alter type public.estado_intencion add value if not exists 'CONTACTANDO';

-- ---------------------------------------------------------------------
-- registrar_promesa(): nueva versión de la promesa, atómica e idempotente.
--  · Bloquea la fila del envío (serializa turnos concurrentes del mismo envío).
--  · Idempotencia:
--      p_idem        → si ya existe una promesa con evidencia->>'idem' = p_idem, la devuelve.
--      p_version_base→ si ya existe la versión p_version_base+1, la devuelve (réplica).
--      mismo contenido que la vigente → devuelve la vigente sin crear versión.
--  · Marca la anterior como vigente=false, inserta version = max+1 y actualiza envios.estado_buffer.
-- Devuelve jsonb {promesa, idempotente, version_anterior}.
-- ---------------------------------------------------------------------
create or replace function public.registrar_promesa(
  p_envio_id         uuid,
  p_estado           text,
  p_confianza        numeric,
  p_fecha_entrega    date        default null,
  p_franja_inicio    timestamptz default null,
  p_franja_fin       timestamptz default null,
  p_preferencia_pago text        default null,
  p_nota_mensajero   text        default null,
  p_evidencia        jsonb       default '{}'::jsonb,
  p_origen           text        default 'agente',
  p_tardia           boolean     default false,
  p_version_base     integer     default null,
  p_idem             text        default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_act   public.promesas;
  v_nueva public.promesas;
  v_max   integer;
  v_est   public.estado_intencion := p_estado::public.estado_intencion;
begin
  perform 1 from public.envios where id = p_envio_id for update;
  if not found then
    raise exception 'envio_no_existe';
  end if;

  if p_idem is not null then
    select * into v_nueva from public.promesas
     where envio_id = p_envio_id and evidencia ->> 'idem' = p_idem
     order by version desc limit 1;
    if v_nueva.id is not null then
      return jsonb_build_object('promesa', to_jsonb(v_nueva), 'idempotente', true, 'version_anterior', null);
    end if;
  end if;

  if p_version_base is not null then
    select * into v_nueva from public.promesas where envio_id = p_envio_id and version = p_version_base + 1;
    if v_nueva.id is not null then
      return jsonb_build_object('promesa', to_jsonb(v_nueva), 'idempotente', true, 'version_anterior', p_version_base);
    end if;
  end if;

  select * into v_act from public.promesas where envio_id = p_envio_id and vigente;
  if v_act.id is not null
     and v_act.estado = v_est
     and v_act.confianza is not distinct from p_confianza
     and v_act.fecha_entrega is not distinct from p_fecha_entrega
     and v_act.franja_inicio is not distinct from p_franja_inicio
     and v_act.franja_fin is not distinct from p_franja_fin
     and v_act.preferencia_pago is not distinct from p_preferencia_pago
     and v_act.nota_mensajero is not distinct from p_nota_mensajero then
    return jsonb_build_object('promesa', to_jsonb(v_act), 'idempotente', true, 'version_anterior', v_act.version);
  end if;

  select coalesce(max(version), 0) into v_max from public.promesas where envio_id = p_envio_id;
  update public.promesas set vigente = false, vigente_hasta = now() where envio_id = p_envio_id and vigente;
  insert into public.promesas (envio_id, version, vigente, estado, fecha_entrega, franja_inicio, franja_fin, confianza,
                               preferencia_pago, nota_mensajero, evidencia, tardia, origen)
  values (p_envio_id, v_max + 1, true, v_est, p_fecha_entrega, p_franja_inicio, p_franja_fin, p_confianza,
          p_preferencia_pago, p_nota_mensajero, coalesce(p_evidencia, '{}'::jsonb), coalesce(p_tardia, false), p_origen)
  returning * into v_nueva;
  update public.envios set estado_buffer = v_est where id = p_envio_id;

  return jsonb_build_object('promesa', to_jsonb(v_nueva), 'idempotente', false, 'version_anterior', v_act.version);
end $$;
revoke all on function public.registrar_promesa(uuid, text, numeric, date, timestamptz, timestamptz, text, text, jsonb, text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.registrar_promesa(uuid, text, numeric, date, timestamptz, timestamptz, text, text, jsonb, text, boolean, integer, text) to service_role;

-- Índice para buscar el caso "tomado" de un envío (silencia al agente)
create index if not exists casos_envio_estado_idx on public.casos (envio_id, estado);
