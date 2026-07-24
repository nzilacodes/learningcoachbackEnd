
-- 1) Add lesson_type enum + columns
DO $$ BEGIN
  CREATE TYPE public.lesson_type AS ENUM (
    'vocabulary','grammar','reading','listening','writing','speaking',
    'pronunciation','ipa','review','quiz','final_test','project'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS lesson_type public.lesson_type;

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS theme text;

CREATE INDEX IF NOT EXISTS idx_lessons_type ON public.lessons(lesson_type);

-- 2) Seed academic structure
DO $seed$
DECLARE
  v_levels public.cefr_level[] := ARRAY['A1','A2','B1','B2','C1','C2']::public.cefr_level[];
  v_lvl public.cefr_level;
  v_lvl_idx int;
  v_course_id uuid;
  v_unit_id uuid;
  v_themes text[];
  v_theme text;
  v_i int;
  v_j int;
  v_types text[] := ARRAY['vocabulary','grammar','reading','listening','writing','speaking','pronunciation','ipa','review','quiz','final_test','project'];
  v_titles text[] := ARRAY['Vocabulary','Grammar','Reading','Listening','Writing','Speaking','Pronunciation','IPA & Sounds','Review','Quiz','Final Test','Project'];
  v_type text;
  v_type_title text;
  v_content jsonb;
  v_level_themes jsonb := jsonb_build_object(
    'A1', jsonb_build_array(
      'Greetings & Introductions','Personal Information','Numbers, Dates & Time','Family & Relationships',
      'Colours & Clothing','Home & Rooms','Food & Drink Basics','Daily Routine',
      'Weather & Seasons','Jobs & Occupations','Places in Town','Shopping Basics',
      'Hobbies & Free Time','Transport & Travel','Health & Body','Directions',
      'Weekend Plans','Feelings & Emotions','Animals & Nature','School & Learning',
      'Holidays & Celebrations','Consolidation & Review'),
    'A2', jsonb_build_array(
      'My Background','Past Experiences','Travel Plans','Restaurants & Cuisine',
      'Shopping Habits','Free-Time Activities','Sports & Movement','Everyday Technology',
      'Home Life','Neighbourhoods','Health & Fitness','Weather & Climate',
      'Work Life','Studying Abroad','Movies & Television','Music Tastes',
      'Books & Stories','Environment Basics','Festivals Around the World','Making Plans',
      'Personal Goals','Consolidation & Review'),
    'B1', jsonb_build_array(
      'Identity & Culture','Life Stories','Media Habits','Work & Careers',
      'Education Systems','Travel Adventures','Money & Spending','Health & Wellbeing',
      'Technology Today','Environment & Climate','Cities vs Countryside','Volunteering',
      'Relationships','Arts & Entertainment','Social Media','News & Current Events',
      'Food Culture','Sports & Competition','Housing','Personal Growth',
      'Ethics in Everyday Life','Consolidation & Review'),
    'B2', jsonb_build_array(
      'Modern Lifestyles','Global Issues','Workplace Culture','Career Paths',
      'Education Debates','Science & Discovery','Digital Citizenship','Sustainability',
      'Health Systems','Urbanisation','Media Literacy','Arts Criticism',
      'History & Memory','Migration','Innovation','Business Basics',
      'Consumer Society','Psychology of Habits','Public Speaking','Debate & Argument',
      'Ethical Dilemmas','Consolidation & Review'),
    'C1', jsonb_build_array(
      'Language & Identity','Geopolitics','Economic Trends','Scientific Research',
      'Bioethics','Artificial Intelligence','Environmental Policy','Global Health',
      'Cultural Heritage','Modern Literature','Cinema & Narrative','Journalism Today',
      'Innovation & Startups','Leadership','Negotiation','Academic Writing',
      'Rhetoric & Persuasion','Philosophy of Mind','Neuroscience of Learning','Sociolinguistics',
      'Future of Work','Consolidation & Review'),
    'C2', jsonb_build_array(
      'Discourse & Pragmatics','Stylistics','Literary Criticism','Political Rhetoric',
      'Academic Discourse','Legal English','Business Strategy','Diplomatic Language',
      'Scientific Paradigms','Ethics of Technology','Philosophy of Language','Cognitive Science',
      'Comparative Culture','Media Theory','Advanced Translation','Creative Nonfiction',
      'Poetry & Prosody','Debate & Dialectics','Public Intellectualism','Cross-Cultural Communication',
      'Research Methodology','Mastery Consolidation')
  );
BEGIN
  FOR v_lvl_idx IN 1..array_length(v_levels,1) LOOP
    v_lvl := v_levels[v_lvl_idx];

    -- upsert course per level
    INSERT INTO public.courses (slug, title, description, level, order_index, is_published)
    VALUES (
      'english-' || lower(v_lvl::text),
      'English ' || v_lvl::text || ' — Complete Course',
      'Original CEFR-aligned ' || v_lvl::text || ' course inspired by modern methodologies (Cambridge, Oxford, Pearson, Macmillan) with 22 thematic units covering vocabulary, grammar, four skills, pronunciation, IPA, review, quizzes, a final test and a real-world project.',
      v_lvl,
      v_lvl_idx,
      true
    )
    ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description
    RETURNING id INTO v_course_id;

    SELECT ARRAY(SELECT jsonb_array_elements_text(v_level_themes -> v_lvl::text)) INTO v_themes;

    FOR v_i IN 1..array_length(v_themes,1) LOOP
      v_theme := v_themes[v_i];

      INSERT INTO public.units (course_id, title, description, order_index, theme)
      VALUES (
        v_course_id,
        'Unit ' || v_i || ': ' || v_theme,
        'CEFR ' || v_lvl::text || ' thematic unit exploring "' || v_theme || '" through 12 integrated lessons.',
        v_i,
        v_theme
      )
      RETURNING id INTO v_unit_id;

      FOR v_j IN 1..array_length(v_types,1) LOOP
        v_type := v_types[v_j];
        v_type_title := v_titles[v_j];

        v_content := CASE v_type
          WHEN 'vocabulary' THEN jsonb_build_object(
            'objective','Acquire and activate core lexis for the theme "'||v_theme||'" at '||v_lvl::text||'.',
            'wordlist', jsonb_build_array(
              jsonb_build_object('word','term_1','pos','noun','definition','Original definition to be edited.','example','Example sentence about '||v_theme||'.'),
              jsonb_build_object('word','term_2','pos','verb','definition','Original definition to be edited.','example','Example sentence about '||v_theme||'.'),
              jsonb_build_object('word','term_3','pos','adjective','definition','Original definition to be edited.','example','Example sentence about '||v_theme||'.'),
              jsonb_build_object('word','term_4','pos','collocation','definition','Original definition to be edited.','example','Example sentence about '||v_theme||'.'),
              jsonb_build_object('word','term_5','pos','phrase','definition','Original definition to be edited.','example','Example sentence about '||v_theme||'.')
            ),
            'activities', jsonb_build_array('matching','gap-fill','word-formation','collocation-grid'))
          WHEN 'grammar' THEN jsonb_build_object(
            'objective','Master a key grammar point relevant to "'||v_theme||'" at '||v_lvl::text||'.',
            'focus','Grammar point tuned to '||v_lvl::text||' descriptors.',
            'rule','Concise, original rule explanation aligned with CEFR '||v_lvl::text||'.',
            'examples', jsonb_build_array('Example 1','Example 2','Example 3'),
            'practice', jsonb_build_array('transformation','error-correction','controlled-production'))
          WHEN 'reading' THEN jsonb_build_object(
            'objective','Develop reading strategies (skimming, scanning, inference) on the theme "'||v_theme||'".',
            'text_title','Reading: '||v_theme,
            'text','[Original CEFR '||v_lvl::text||' passage of ~150–300 words about '||v_theme||' — to be finalised by content team.]',
            'tasks', jsonb_build_array('gist question','3 detail questions','vocabulary in context','inference'))
          WHEN 'listening' THEN jsonb_build_object(
            'objective','Develop listening for gist and detail using authentic-style audio on "'||v_theme||'".',
            'audio_script','[Original CEFR '||v_lvl::text||' dialogue/monologue script about '||v_theme||'.]',
            'tasks', jsonb_build_array('predict','listen for gist','multiple-choice detail','note-taking'))
          WHEN 'writing' THEN jsonb_build_object(
            'objective','Produce a short written text on "'||v_theme||'" appropriate to '||v_lvl::text||'.',
            'prompt','Write a '||CASE WHEN v_lvl IN ('A1','A2') THEN '60–100' WHEN v_lvl IN ('B1','B2') THEN '150–200' ELSE '250–350' END||'-word text about '||v_theme||'.',
            'rubric', jsonb_build_array('task achievement','coherence','range','accuracy'))
          WHEN 'speaking' THEN jsonb_build_object(
            'objective','Deliver a fluent, intelligible spoken response on "'||v_theme||'".',
            'prompt','Talk for '||CASE WHEN v_lvl IN ('A1','A2') THEN '1' WHEN v_lvl IN ('B1','B2') THEN '2' ELSE '3–4' END||' minute(s) about '||v_theme||'.',
            'functions', jsonb_build_array('describing','comparing','opining','justifying'),
            'rubric', jsonb_build_array('fluency','coherence','lexis','grammar','pronunciation'))
          WHEN 'pronunciation' THEN jsonb_build_object(
            'objective','Improve segmental and suprasegmental features linked to "'||v_theme||'".',
            'focus','Minimal pairs and word stress within the unit lexis.',
            'drills', jsonb_build_array('choral drill','minimal pairs','shadowing','recording & feedback'))
          WHEN 'ipa' THEN jsonb_build_object(
            'objective','Read and produce IPA transcriptions for target words from "'||v_theme||'".',
            'symbols', jsonb_build_array('/iː/','/ɪ/','/e/','/æ/','/ʌ/','/ɔː/','/uː/','/ə/','/θ/','/ð/','/ʃ/','/ʒ/','/tʃ/','/dʒ/'),
            'tasks', jsonb_build_array('transcribe 10 target words','decode 10 IPA strings','stress marking'))
          WHEN 'review' THEN jsonb_build_object(
            'objective','Consolidate the unit: recycle lexis, grammar and skills from "'||v_theme||'".',
            'recap', jsonb_build_array('key vocabulary','key grammar','functional phrases','common errors'),
            'activities', jsonb_build_array('mind-map','self-check quiz','peer teaching'))
          WHEN 'quiz' THEN jsonb_build_object(
            'objective','Formative check on unit content.',
            'format','10 items (MCQ, gap-fill, matching)',
            'pass_score',60)
          WHEN 'final_test' THEN jsonb_build_object(
            'objective','Summative test covering all skills for the unit "'||v_theme||'".',
            'sections', jsonb_build_array('Use of English','Reading','Listening','Writing','Speaking'),
            'pass_score',70)
          WHEN 'project' THEN jsonb_build_object(
            'objective','Apply unit learning in a real-world task connected to "'||v_theme||'".',
            'task', CASE v_lvl::text
              WHEN 'A1' THEN 'Create a simple poster or short recording about '||v_theme||'.'
              WHEN 'A2' THEN 'Prepare a short presentation (2–3 min) about '||v_theme||'.'
              WHEN 'B1' THEN 'Produce a blog post or vlog (3–4 min) about '||v_theme||'.'
              WHEN 'B2' THEN 'Design an infographic + spoken commentary about '||v_theme||'.'
              WHEN 'C1' THEN 'Write an opinion article and record a 4–5 min podcast on '||v_theme||'.'
              ELSE 'Deliver a mini-conference talk with slides on '||v_theme||'.'
            END,
            'deliverables', jsonb_build_array('artifact','self-reflection','peer feedback'))
        END;

        INSERT INTO public.lessons (unit_id, slug, title, summary, content, duration_min, xp_reward, order_index, is_published, lesson_type)
        VALUES (
          v_unit_id,
          v_type,
          v_type_title || ' — ' || v_theme,
          v_type_title || ' lesson for CEFR '||v_lvl::text||' unit "'||v_theme||'".',
          v_content,
          CASE v_type WHEN 'final_test' THEN 45 WHEN 'project' THEN 60 WHEN 'quiz' THEN 15 ELSE 20 END,
          CASE v_type WHEN 'final_test' THEN 50 WHEN 'project' THEN 40 WHEN 'quiz' THEN 20 ELSE 10 END,
          v_j,
          true,
          v_type::public.lesson_type
        )
        ON CONFLICT (unit_id, slug) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $seed$;
