
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;

-- XP events log
CREATE TABLE IF NOT EXISTS public.xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  coins integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.xp_events TO authenticated;
GRANT ALL ON public.xp_events TO service_role;
ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own xp events read" ON public.xp_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own xp events insert" ON public.xp_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS xp_events_user_date ON public.xp_events(user_id, created_at DESC);

-- Missions catalog
CREATE TABLE IF NOT EXISTS public.missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  scope text NOT NULL CHECK (scope IN ('daily','weekly','monthly')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  action_type text NOT NULL,
  target integer NOT NULL DEFAULT 1,
  xp_reward integer NOT NULL DEFAULT 0,
  coin_reward integer NOT NULL DEFAULT 0,
  icon text NOT NULL DEFAULT '🎯',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.missions TO anon, authenticated;
GRANT ALL ON public.missions TO service_role;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "missions readable" ON public.missions FOR SELECT USING (true);

-- User missions progress
CREATE TABLE IF NOT EXISTS public.user_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  claimed_at timestamptz,
  UNIQUE(user_id, mission_id, period_key)
);
GRANT SELECT, INSERT, UPDATE ON public.user_missions TO authenticated;
GRANT ALL ON public.user_missions TO service_role;
ALTER TABLE public.user_missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own missions read" ON public.user_missions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own missions insert" ON public.user_missions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own missions update" ON public.user_missions FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Shop
CREATE TABLE IF NOT EXISTS public.shop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  category text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  cost_coins integer NOT NULL,
  icon text NOT NULL DEFAULT '🎁',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.shop_items TO anon, authenticated;
GRANT ALL ON public.shop_items TO service_role;
ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shop readable" ON public.shop_items FOR SELECT USING (true);

-- Inventory
CREATE TABLE IF NOT EXISTS public.user_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  equipped boolean NOT NULL DEFAULT false,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_inventory TO authenticated;
GRANT ALL ON public.user_inventory TO service_role;
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own inventory" ON public.user_inventory FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Friendships (bidirectional; user_id is the requester)
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending','accepted','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, friend_id),
  CHECK (user_id <> friend_id)
);
GRANT SELECT, INSERT, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own friendships read" ON public.friendships FOR SELECT TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);
CREATE POLICY "own friendships insert" ON public.friendships FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own friendships delete" ON public.friendships FOR DELETE TO authenticated USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Level formula
CREATE OR REPLACE FUNCTION public.xp_to_level(_xp integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT GREATEST(1, floor(sqrt(GREATEST(_xp,0)::numeric / 50))::int + 1)
$$;
GRANT EXECUTE ON FUNCTION public.xp_to_level(integer) TO anon, authenticated;

-- Award XP + coins + streak + mission progress
CREATE OR REPLACE FUNCTION public.award_activity(_source text, _xp integer, _coins integer DEFAULT 0, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  prev_xp int; new_xp int;
  prev_level int; new_level int;
  prev_streak int; last_date date;
  new_streak int;
  today date := (now() at time zone 'utc')::date;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  INSERT INTO public.xp_events(user_id, source, amount, coins, meta)
    VALUES (uid, _source, GREATEST(_xp,0), GREATEST(_coins,0), _meta);

  SELECT COALESCE(xp,0), COALESCE(level,1), COALESCE(streak,0), last_active_date
    INTO prev_xp, prev_level, prev_streak, last_date
    FROM public.profiles WHERE id = uid;

  new_xp := prev_xp + GREATEST(_xp,0);
  new_level := public.xp_to_level(new_xp);

  IF last_date IS NULL OR last_date < today - 1 THEN
    new_streak := 1;
  ELSIF last_date = today - 1 THEN
    new_streak := prev_streak + 1;
  ELSE
    new_streak := GREATEST(prev_streak, 1);
  END IF;

  UPDATE public.profiles
     SET xp = new_xp,
         level = new_level,
         streak = new_streak,
         coins = COALESCE(coins,0) + GREATEST(_coins,0),
         last_active_date = today
   WHERE id = uid;

  INSERT INTO public.user_stats(user_id, xp, streak_days, last_activity_date)
    VALUES (uid, new_xp, new_streak, today)
    ON CONFLICT (user_id) DO UPDATE SET xp = EXCLUDED.xp, streak_days = EXCLUDED.streak_days, last_activity_date = EXCLUDED.last_activity_date, updated_at = now();

  UPDATE public.user_missions um
     SET progress = LEAST(m.target, um.progress + 1),
         completed_at = CASE WHEN um.progress + 1 >= m.target AND um.completed_at IS NULL THEN now() ELSE um.completed_at END
    FROM public.missions m
   WHERE um.mission_id = m.id
     AND um.user_id = uid
     AND m.action_type = _source
     AND um.completed_at IS NULL;

  RETURN jsonb_build_object(
    'xp', new_xp, 'gained', GREATEST(_xp,0), 'level', new_level, 'level_up', new_level > prev_level,
    'streak', new_streak, 'coins_gained', GREATEST(_coins,0)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.award_activity(text, integer, integer, jsonb) TO authenticated;

-- Claim a completed mission
CREATE OR REPLACE FUNCTION public.claim_mission(_mission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  m record; um record;
  key text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO m FROM public.missions WHERE id = _mission_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'mission not found'; END IF;

  key := CASE m.scope
    WHEN 'daily' THEN to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD')
    WHEN 'weekly' THEN to_char(now() at time zone 'utc', 'IYYY-"W"IW')
    WHEN 'monthly' THEN to_char(now() at time zone 'utc', 'YYYY-MM')
  END;

  SELECT * INTO um FROM public.user_missions WHERE user_id = uid AND mission_id = _mission_id AND period_key = key;
  IF NOT FOUND OR um.completed_at IS NULL THEN RAISE EXCEPTION 'not completed'; END IF;
  IF um.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'already claimed'; END IF;

  UPDATE public.user_missions SET claimed_at = now() WHERE id = um.id;
  UPDATE public.profiles
     SET xp = COALESCE(xp,0) + m.xp_reward,
         coins = COALESCE(coins,0) + m.coin_reward,
         level = public.xp_to_level(COALESCE(xp,0) + m.xp_reward)
   WHERE id = uid;

  INSERT INTO public.xp_events(user_id, source, amount, coins, meta)
    VALUES (uid, 'mission:'||m.code, m.xp_reward, m.coin_reward, jsonb_build_object('mission_id', m.id));

  RETURN jsonb_build_object('xp', m.xp_reward, 'coins', m.coin_reward);
END; $$;
GRANT EXECUTE ON FUNCTION public.claim_mission(uuid) TO authenticated;

-- Ensure mission rows for current period
CREATE OR REPLACE FUNCTION public.ensure_user_missions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  m record;
  key text;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  FOR m IN SELECT * FROM public.missions WHERE is_active LOOP
    key := CASE m.scope
      WHEN 'daily' THEN to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD')
      WHEN 'weekly' THEN to_char(now() at time zone 'utc', 'IYYY-"W"IW')
      WHEN 'monthly' THEN to_char(now() at time zone 'utc', 'YYYY-MM')
    END;
    INSERT INTO public.user_missions(user_id, mission_id, period_key)
      VALUES (uid, m.id, key)
      ON CONFLICT DO NOTHING;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.ensure_user_missions() TO authenticated;

-- Buy shop item
CREATE OR REPLACE FUNCTION public.buy_shop_item(_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  it record;
  bal int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO it FROM public.shop_items WHERE id = _item_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'item not available'; END IF;
  SELECT COALESCE(coins,0) INTO bal FROM public.profiles WHERE id = uid;
  IF bal < it.cost_coins THEN RAISE EXCEPTION 'insufficient coins'; END IF;

  UPDATE public.profiles SET coins = bal - it.cost_coins WHERE id = uid;
  INSERT INTO public.user_inventory(user_id, item_id) VALUES (uid, _item_id)
    ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'remaining_coins', bal - it.cost_coins);
END; $$;
GRANT EXECUTE ON FUNCTION public.buy_shop_item(uuid) TO authenticated;

-- Seeds
INSERT INTO public.missions (code, scope, title, description, action_type, target, xp_reward, coin_reward, icon) VALUES
  ('daily_lesson', 'daily', 'Completa 1 aula', 'Termina qualquer lição hoje', 'lesson_complete', 1, 30, 15, '📚'),
  ('daily_speak', 'daily', 'Pratica speaking', 'Faz 1 gravação de pronúncia', 'speaking', 1, 20, 10, '🎤'),
  ('daily_video', 'daily', 'Assiste 1 vídeo', 'Vê um vídeo do YouTube', 'watch_video', 1, 15, 5, '📺'),
  ('weekly_lessons', 'weekly', '5 aulas semanais', 'Completa 5 aulas esta semana', 'lesson_complete', 5, 200, 100, '🏆'),
  ('weekly_reading', 'weekly', '3 leituras Read Aloud', 'Faz 3 leituras em voz alta', 'reading', 3, 150, 60, '📖'),
  ('monthly_master', 'monthly', 'Mestre do mês', 'Completa 20 aulas no mês', 'lesson_complete', 20, 1000, 500, '👑')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.shop_items (code, category, name, description, cost_coins, icon, payload) VALUES
  ('avatar_crown', 'avatar', 'Coroa Dourada', 'Uma coroa brilhante para o teu avatar', 300, '👑', '{"type":"hat","asset":"crown"}'),
  ('avatar_frame_gold', 'avatar', 'Moldura Dourada', 'Moldura brilhante para o avatar', 500, '🖼️', '{"type":"frame","asset":"gold"}'),
  ('avatar_glasses', 'avatar', 'Óculos Estilo', 'Muito style', 200, '🕶️', '{"type":"accessory","asset":"glasses"}'),
  ('avatar_wizard', 'avatar', 'Chapéu de Mago', 'Poder mágico', 400, '🧙', '{"type":"hat","asset":"wizard"}'),
  ('theme_neon', 'theme', 'Tema Neon', 'Interface em modo neon', 800, '🌈', '{"type":"theme","asset":"neon"}'),
  ('streak_freeze', 'boost', 'Freeze de Streak', 'Protege o teu streak por 1 dia', 250, '🧊', '{"type":"freeze","days":1}'),
  ('xp_boost_2h', 'boost', 'Boost 2x XP (2h)', 'Duplica XP durante 2 horas', 400, '⚡', '{"type":"xp_boost","multiplier":2,"hours":2}')
ON CONFLICT (code) DO NOTHING;
