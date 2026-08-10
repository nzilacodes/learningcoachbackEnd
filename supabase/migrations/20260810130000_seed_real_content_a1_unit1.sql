-- Replaces the auto-generated placeholder content ("term_1", "Original definition
-- to be edited.") with real, reviewed pedagogical content for one full unit —
-- A1 "Unit 1: Greetings & Introductions" — as a working example of what an
-- authored lesson looks like end to end. The other units remain the template
-- placeholder, editable via the admin curriculum editor (PATCH /v1/admin/lessons/:id).
DO $seed$
DECLARE
  v_unit_id uuid;
  v_lesson_id uuid;
BEGIN
  SELECT u.id INTO v_unit_id
  FROM public.units u
  JOIN public.courses c ON c.id = u.course_id
  WHERE c.level = 'A1' AND u.title = 'Unit 1: Greetings & Introductions';

  IF v_unit_id IS NULL THEN
    RAISE NOTICE 'A1 Unit 1 not found — skipping real-content seed.';
    RETURN;
  END IF;

  -- 1) Vocabulary
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Learn and use core greeting and introduction vocabulary.",
    "wordlist": [
      { "word": "hello", "pos": "interjection", "definition": "A common greeting used when meeting someone.", "example": "Hello! How are you today?" },
      { "word": "name", "pos": "noun", "definition": "What a person or thing is called.", "example": "My name is Sarah." },
      { "word": "nice to meet you", "pos": "phrase", "definition": "A polite thing to say when you meet someone for the first time.", "example": "Nice to meet you! I'm John." },
      { "word": "introduce", "pos": "verb", "definition": "To tell someone your name or another person's name for the first time.", "example": "Let me introduce myself — I'm Carlos." },
      { "word": "friend", "pos": "noun", "definition": "A person you know well and like.", "example": "This is my friend, Maria." }
    ],
    "activities": ["matching", "gap-fill", "role-play greetings", "picture-word matching"]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'vocabulary';

  -- 2) Grammar
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Use the present simple of 'to be' (am/is/are) to introduce yourself and others.",
    "focus": "Present simple of the verb 'to be' for personal introductions.",
    "rule": "Use 'I am' (I'm) for yourself, 'You are' (You're) for the person you're talking to, and 'He/She is' (He's/She's) for someone else. Example: I am Ana. You are David. She is my teacher.",
    "examples": ["I am from Angola.", "You are very kind.", "She is my sister.", "They are my classmates."],
    "practice": ["Complete with am/is/are", "Rewrite sentences using contractions", "Introduce a partner using 'This is...'"]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'grammar';

  -- 3) Reading
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Practise reading for gist and detail in a short introduction story.",
    "text_title": "A New Student",
    "text": "Hi! My name is Miguel. I am from Luanda, Angola. I am fourteen years old. Today is my first day at this school. I am a little nervous, but everyone is very friendly. My new classmate, Ana, says, 'Hello, Miguel! Nice to meet you. Welcome to our class!' I smile and say, 'Thank you! Nice to meet you too.' I think I am going to like it here.",
    "tasks": [
      "Who is the new student?",
      "Where is Miguel from?",
      "How old is Miguel?",
      "What does Ana say to Miguel?",
      "Find one word in the text that means 'happy to see someone'."
    ]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'reading';

  -- 4) Listening
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Practise listening for gist and detail in a classroom introduction.",
    "audio_script": "Teacher: Good morning, everyone! Today we have a new student. Please introduce yourself. New student: Good morning! My name is Sofia. I'm from Portugal. I'm twelve years old, and I love reading books. Teacher: Welcome, Sofia! Class, please say hello. Class: Hello, Sofia!",
    "tasks": [
      "Listen and write the new student's name.",
      "Where is Sofia from?",
      "What does Sofia love doing?",
      "Listen again and repeat the class's greeting."
    ]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'listening';

  -- 5) Writing
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Write a short personal introduction.",
    "prompt": "Write a short paragraph (60-100 words) introducing yourself. Include your name, age, where you are from, and one thing you like.",
    "rubric": ["task achievement (all points included)", "coherence (ideas are clear and in order)", "range (uses greeting/introduction vocabulary)", "accuracy (correct use of am/is/are)"]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'writing';

  -- 6) Speaking
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Introduce yourself out loud, fluently and clearly.",
    "prompt": "Introduce yourself to a partner: say your name, where you're from, and one fact about yourself. Then ask your partner the same questions.",
    "functions": ["greeting", "giving personal information", "asking questions politely"],
    "rubric": ["fluency", "coherence", "lexis (greeting vocabulary)", "grammar (am/is/are)", "pronunciation"]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'speaking';

  -- 7) Pronunciation
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Pronounce greetings clearly, with correct word stress and the /h/ sound.",
    "focus": "Word stress in greetings and the /h/ sound in 'hello' and 'how'.",
    "drills": [
      "Choral repetition: Hello, Hi, How are you?",
      "Minimal pairs: hello / yellow",
      "Shadow the audio: 'Nice to MEET you'",
      "Record yourself saying 'Hello, my name is...' and compare to the model"
    ]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'pronunciation';

  -- 8) IPA
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Read and produce IPA transcriptions for greeting vocabulary.",
    "symbols": ["/h/", "/ə/", "/oʊ/", "/aɪ/", "/iː/"],
    "tasks": ["Transcribe: hello, name, nice, meet, you, I", "Decode: /həˈloʊ/, /neɪm/, /naɪs/", "Mark the stressed syllable in 'introduce'"]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'ipa';

  -- 9) Review
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Consolidate the unit: greetings, introductions and 'to be'.",
    "recap": ["Greeting vocabulary (hello, hi, nice to meet you)", "Verb 'to be' (am/is/are)", "Asking and answering 'What's your name?'", "Common mistake: 'I am agree' should be 'I agree'"],
    "activities": ["Mind-map of greeting expressions", "Self-check quiz (5 questions)", "Peer teaching: explain am/is/are to a partner"]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'review';

  -- 10) Quiz — content + real MCQ exercises
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Formative check on greetings, introductions and 'to be'.",
    "format": "5 items (multiple choice)",
    "pass_score": 60
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'quiz';

  SELECT id INTO v_lesson_id FROM public.lessons WHERE unit_id = v_unit_id AND slug = 'quiz';
  IF v_lesson_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.exercises WHERE lesson_id = v_lesson_id) THEN
    INSERT INTO public.exercises (lesson_id, type, prompt, data, correct_answer, xp_reward, order_index) VALUES
      (v_lesson_id, 'mcq', 'What do you say when you meet someone for the first time?',
        '{"options": ["Goodbye!", "Nice to meet you!", "See you later.", "I''m tired."]}'::jsonb, '{"index": 1}'::jsonb, 5, 1),
      (v_lesson_id, 'mcq', 'Complete: "I ___ from Angola."',
        '{"options": ["is", "am", "are", "be"]}'::jsonb, '{"index": 1}'::jsonb, 5, 2),
      (v_lesson_id, 'mcq', 'Complete: "She ___ my friend."',
        '{"options": ["am", "are", "is", "be"]}'::jsonb, '{"index": 2}'::jsonb, 5, 3),
      (v_lesson_id, 'mcq', 'What is the short form of "I am"?',
        '{"options": ["I''m", "I''s", "Im''", "I''am"]}'::jsonb, '{"index": 0}'::jsonb, 5, 4),
      (v_lesson_id, 'mcq', 'Choose the correct question: "___ your name?"',
        '{"options": ["What''s", "Who''s", "Where''s", "How''s"]}'::jsonb, '{"index": 0}'::jsonb, 5, 5);
  END IF;

  -- 11) Final test — content + real MCQ exercises
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Summative test covering all skills for Unit 1: Greetings & Introductions.",
    "sections": ["Use of English", "Reading", "Listening", "Writing", "Speaking"],
    "pass_score": 70
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'final_test';

  SELECT id INTO v_lesson_id FROM public.lessons WHERE unit_id = v_unit_id AND slug = 'final_test';
  IF v_lesson_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.exercises WHERE lesson_id = v_lesson_id) THEN
    INSERT INTO public.exercises (lesson_id, type, prompt, data, correct_answer, xp_reward, order_index) VALUES
      (v_lesson_id, 'mcq', 'Which sentence is correct?',
        '{"options": ["She are nice.", "She is nice.", "She am nice.", "She be nice."]}'::jsonb, '{"index": 1}'::jsonb, 10, 1),
      (v_lesson_id, 'mcq', '"___ you a student?" Choose the correct word.',
        '{"options": ["Is", "Am", "Are", "Be"]}'::jsonb, '{"index": 2}'::jsonb, 10, 2),
      (v_lesson_id, 'mcq', '"Nice to meet you" is used when...',
        '{"options": ["saying goodbye", "meeting someone for the first time", "asking for help", "ordering food"]}'::jsonb, '{"index": 1}'::jsonb, 10, 3),
      (v_lesson_id, 'mcq', 'Complete: "My name ___ Carlos."',
        '{"options": ["am", "is", "are", "were"]}'::jsonb, '{"index": 1}'::jsonb, 10, 4),
      (v_lesson_id, 'mcq', 'Choose the polite greeting.',
        '{"options": ["Hey you!", "Hello, nice to meet you.", "What do you want?", "Go away."]}'::jsonb, '{"index": 1}'::jsonb, 10, 5);
  END IF;

  -- 12) Project
  UPDATE public.lessons SET content = $json$
  {
    "objective": "Apply the unit's greetings and introductions in a short real-world task.",
    "task": "Create a simple poster or short recording (30-60 seconds) introducing yourself: your name, age, where you're from, and one hobby. Use at least 3 greeting expressions from this unit.",
    "deliverables": ["artifact (poster or recording)", "self-reflection (2 sentences on what was easy/hard)", "peer feedback (one classmate comments)"]
  }
  $json$::jsonb
  WHERE unit_id = v_unit_id AND slug = 'project';
END $seed$;
