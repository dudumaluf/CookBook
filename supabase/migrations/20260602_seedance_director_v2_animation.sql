-- 2026-06-02 — Seedance Prompt Director v2: add Animation / Timed Segments template
-- (Cookbook Library Phase D2).
--
-- Adds a 6th template (cursor = 5) — multi-beat single-shot scene. Best for
-- scenes that need visible time progression without cuts (e.g. character
-- pours coffee, lifts cup, takes sip in one shot). Mirrors the structure
-- of the new Timeline Director recipe but stays inside the Seedance
-- Director's existing 5-template carousel — just one more cursor stop.
--
-- Idempotent — wrapped in a DO block guarded by `version = 1`. A second
-- run is a no-op (the recipe is already at v2). Archives v1 to
-- `cookbook_recipe_versions` so existing canvas composites pinned to v1
-- can show the diff via the Phase B2 history viewer.
--
-- Filename intentionally uses the 2026-06-02 date prefix so it runs AFTER
-- `20260601_seedance_prompt_director_recipe.sql` alphabetically — the v1
-- insert lands first, then the v2 bump runs once.
--
-- Composite instances on canvas pinned to v1 will show the Phase B2
-- "Update available → v2" badge after this migration applies.

do $migrate$
declare
  rid uuid;
  curr_version int;
  curr_subgraph jsonb;
  curr_name text;
  curr_description text;
  curr_category text;
  new_subgraph jsonb;
begin
  -- Locate the system Seedance Prompt Director row.
  select id, version, subgraph, name, description, category
    into rid, curr_version, curr_subgraph, curr_name, curr_description, curr_category
  from public.cookbook_recipes
  where name = 'Seedance Prompt Director' and owner_id is null;

  -- Bail early if missing (v1 migration didn't run yet) or already at v2+.
  if rid is null then
    raise notice 'Seedance Prompt Director not found — skipping v2 bump';
    return;
  end if;

  if curr_version >= 2 then
    raise notice 'Seedance Prompt Director already at v% — skipping', curr_version;
    return;
  end if;

  -- Archive v1 in cookbook_recipe_versions so Phase B2 history shows the
  -- diff. on conflict do nothing covers the (unlikely) case where a
  -- prior run wrote the version row but failed before bumping the live
  -- one — re-running this migration completes the bump cleanly.
  insert into public.cookbook_recipe_versions (
    recipe_id, version, subgraph, name, description, category, saved_by
  ) values (
    rid, curr_version, curr_subgraph, curr_name, curr_description, curr_category, null
  )
  on conflict (recipe_id, version) do nothing;

  -- Build the v2 subgraph by appending the 6th template to the
  -- templates-text Text node's content. Every other node is unchanged;
  -- the array node still splits on ═══BREAK═══, the list node's cursor
  -- range can now be 0-5 (caller can opt in to template 5 by editing
  -- the param), and the LLM bindings stay identical.
  --
  -- We surgically rewrite the templates-text node's text rather than
  -- re-emitting the entire subgraph — keeps the diff small + future-
  -- proof against unrelated subgraph tweaks landing between v1 and
  -- this migration.
  new_subgraph := jsonb_set(
    curr_subgraph,
    '{nodes}',
    (
      select jsonb_agg(
        case
          when (n->>'id') = 'templates-text' then
            jsonb_set(
              n,
              '{config,text}',
              to_jsonb(
                (n->'config'->>'text')
                || E'\n═══BREAK═══\nTEMPLATE: ANIMATION / TIMED SEGMENTS (multi-beat single shot)\nSingle continuous shot, 5-15 seconds, multiple internal beats. Best for scenes that need visible time progression without cuts (e.g. character pours coffee, lifts cup, takes sip in one shot — three beats, one shot, no edit).\n\nOpen with the duration + aspect line (e.g. 10-second shot, 1 shot, 16:9). Then in PROSE structure the action as 3-5 timed segments using [mm:ss-mm:ss] brackets — Seedance honors this format reliably:\n\n[00:00-00:03] Establishing — <one short beat>. Camera <move>. <ambient audio>.\n[00:03-00:06] Action build — <one short beat>. Camera <move>. <action audio>.\n[00:06-00:09] Apex — <one short beat>. Camera <move>. <impact audio>.\n[00:09-00:12] Resolution — <one short beat>. Camera <move>. <ambient audio>.\n\n3-5 segments per scene. Each segment specifies VISUAL ACTION + camera move + synchronized audio. Time codes inclusive at start, exclusive at end. The shot stays continuous — no cuts between segments, just camera-internal time progression.\n\nIf you need multiple cuts, use the Multi-Shot Commercial template (cursor 2) or the Transformation template (cursor 3) instead.\n\nEnd with: Total: <duration> / 1 shot / <aspect>.'
              )
            )
          else n
        end
      )
      from jsonb_array_elements(curr_subgraph->'nodes') n
    )
  );

  -- Also update the Template knob's label to advertise the new template
  -- without breaking existing instances. The min/max/step on the knob
  -- itself stay the same (composite picker handles 0..4); we widen the
  -- max to 5 so users can opt into the new template via the knob UI.
  new_subgraph := jsonb_set(
    new_subgraph,
    '{exposedParams}',
    (
      select jsonb_agg(
        case
          when p->>'configKey' = 'cursor' and p->>'internalNodeId' = 'templates-list' then
            jsonb_set(
              jsonb_set(
                p,
                '{label}',
                to_jsonb('Template (0:Free 1:1-shot 2:Multi 3:Transform 4:Orb 5:Animation)'::text)
              ),
              '{max}',
              to_jsonb(5)
            )
          else p
        end
      )
      from jsonb_array_elements(new_subgraph->'exposedParams') p
    )
  );

  -- Bump the live row to v2.
  update public.cookbook_recipes
  set
    subgraph = new_subgraph,
    version = 2,
    description = 'Convert a creative briefing + reference images into a polished Seedance 2.0 video prompt. Pick a template (Freeform / Single-shot / Multi-shot Commercial / Transformation / Orb-POV / Animation) by editing the `template` knob on the node. References are tagged @Image1..@ImageN in the output and map straight to the Seedance node downstream. Curated from Fal & Higgsfield prompting guides.'
  where id = rid;

  raise notice 'Seedance Prompt Director bumped to v2 (Animation template added)';
end
$migrate$;
