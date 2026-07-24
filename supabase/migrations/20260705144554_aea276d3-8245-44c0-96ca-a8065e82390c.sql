
-- App settings singleton (configurable pass score)
CREATE TABLE public.app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  min_exam_score INT NOT NULL DEFAULT 70 CHECK (min_exam_score BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read settings" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "Admins can update settings" ON public.app_settings FOR UPDATE
  USING (private.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "Admins can insert settings" ON public.app_settings FOR INSERT
  WITH CHECK (private.has_role(auth.uid(),'admin'::public.app_role));
INSERT INTO public.app_settings (id, min_exam_score) VALUES (true, 70);

-- Level exams (one per CEFR level)
CREATE TABLE public.level_exams (
  level public.cefr_level PRIMARY KEY,
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.level_exams TO authenticated;
GRANT ALL ON public.level_exams TO service_role;
ALTER TABLE public.level_exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read exams" ON public.level_exams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage exams" ON public.level_exams FOR ALL
  USING (private.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(),'admin'::public.app_role));

-- Attempts
CREATE TABLE public.level_exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level public.cefr_level NOT NULL,
  score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  passed BOOLEAN NOT NULL,
  answers JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.level_exam_attempts (user_id, level);
GRANT SELECT, INSERT ON public.level_exam_attempts TO authenticated;
GRANT ALL ON public.level_exam_attempts TO service_role;
ALTER TABLE public.level_exam_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own attempts" ON public.level_exam_attempts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own attempts" ON public.level_exam_attempts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all attempts" ON public.level_exam_attempts FOR SELECT
  USING (private.has_role(auth.uid(),'admin'::public.app_role));

-- Helper: numeric rank of a level (A1=1..C2=6)
CREATE OR REPLACE FUNCTION public.cefr_rank(_level public.cefr_level)
RETURNS INT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _level
    WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 WHEN 'B1' THEN 3
    WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 WHEN 'C2' THEN 6
  END;
$$;

-- Compute max unlocked level for user:
--   base = profile.cefr_level (from diagnostic); then + 1 for every consecutive passed level exam
CREATE OR REPLACE FUNCTION public.get_max_unlocked_level(_user_id UUID)
RETURNS public.cefr_level LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base TEXT;
  v_rank INT;
  v_next public.cefr_level;
BEGIN
  SELECT cefr_level INTO v_base FROM public.profiles WHERE id = _user_id;
  IF v_base IS NULL OR v_base NOT IN ('A1','A2','B1','B2','C1','C2') THEN
    RETURN NULL;
  END IF;
  v_rank := public.cefr_rank(v_base::public.cefr_level);

  LOOP
    EXIT WHEN v_rank >= 6;
    v_next := (ARRAY['A1','A2','B1','B2','C1','C2']::public.cefr_level[])[v_rank];
    -- passed exam of current rank unlocks next
    IF EXISTS (
      SELECT 1 FROM public.level_exam_attempts
      WHERE user_id = _user_id AND level = v_next AND passed = true
    ) THEN
      v_rank := v_rank + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  RETURN (ARRAY['A1','A2','B1','B2','C1','C2']::public.cefr_level[])[v_rank];
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_level(_user_id UUID, _level public.cefr_level)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.cefr_rank(_level) <= public.cefr_rank(public.get_max_unlocked_level(_user_id)), false);
$$;

-- Seed simple level exams (5 MCQ each). Content editable by admin later.
INSERT INTO public.level_exams (level, title, questions) VALUES
('A1','Exame Final A1', '[
  {"q":"___ name is Anna.","opts":["My","Me","I","Mine"],"a":0},
  {"q":"She ___ a teacher.","opts":["are","am","is","be"],"a":2},
  {"q":"Choose the greeting:","opts":["Table","Hello","Book","Red"],"a":1},
  {"q":"I have ___ apple.","opts":["a","an","the","no"],"a":1},
  {"q":"They ___ students.","opts":["is","are","am","be"],"a":1}
]'::jsonb),
('A2','Exame Final A2', '[
  {"q":"Yesterday I ___ to the park.","opts":["go","went","gone","going"],"a":1},
  {"q":"There ___ some milk in the fridge.","opts":["is","are","am","be"],"a":0},
  {"q":"She is ___ than her sister.","opts":["tall","taller","tallest","more tall"],"a":1},
  {"q":"We ___ ever been to Paris.","opts":["have","haven''t","has","hasn''t"],"a":1},
  {"q":"He ___ TV every night.","opts":["watch","watches","watching","watched"],"a":1}
]'::jsonb),
('B1','Exame Final B1', '[
  {"q":"If it rains, we ___ home.","opts":["stay","stayed","will stay","would stay"],"a":2},
  {"q":"I ___ living here since 2019.","opts":["am","have been","was","had"],"a":1},
  {"q":"The book ___ by many students.","opts":["reads","is read","reading","read"],"a":1},
  {"q":"You ___ smoke here — it''s forbidden.","opts":["must","mustn''t","can","should"],"a":1},
  {"q":"He asked me where ___.","opts":["do I live","I live","I lived","I am living"],"a":2}
]'::jsonb),
('B2','Exame Final B2', '[
  {"q":"By 2030, technology ___ everything.","opts":["will change","will have changed","changes","changed"],"a":1},
  {"q":"I wish I ___ more time.","opts":["have","had","would have","has"],"a":1},
  {"q":"He denied ___ the money.","opts":["to steal","stealing","stole","steal"],"a":1},
  {"q":"Not only ___ late, but he also forgot the keys.","opts":["he was","was he","he is","is he"],"a":1},
  {"q":"The report ___ by tomorrow.","opts":["must finish","must be finished","must to finish","finishes"],"a":1}
]'::jsonb),
('C1','Exame Final C1', '[
  {"q":"Had I known, I ___ differently.","opts":["would act","would have acted","had acted","act"],"a":1},
  {"q":"His argument was ___ flawed.","opts":["deep","deeply","depth","deepen"],"a":1},
  {"q":"She''s ___ eating meat for a year.","opts":["given up","given in","given away","given off"],"a":0},
  {"q":"___ the weather, the event went ahead.","opts":["Despite","Although","However","Because"],"a":0},
  {"q":"The proposal ___ serious consideration.","opts":["warrants","warns","wants","wanders"],"a":0}
]'::jsonb),
('C2','Exame Final C2', '[
  {"q":"His speech was nothing ___ brilliant.","opts":["short of","shortly","short from","short"],"a":0},
  {"q":"Little ___ that the deal had collapsed.","opts":["he knew","did he know","he did know","knew he"],"a":1},
  {"q":"The findings ___ previous theories.","opts":["corroborate","corroded","correspond of","correlated of"],"a":0},
  {"q":"She''s ___ a formidable opponent.","opts":["nothing but","anything but","something but","nothing so"],"a":0},
  {"q":"His remarks were construed ___ criticism.","opts":["as","of","from","with"],"a":0}
]'::jsonb);
