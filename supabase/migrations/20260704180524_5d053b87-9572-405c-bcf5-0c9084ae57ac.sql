
CREATE OR REPLACE FUNCTION public.moderate_community_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  banned TEXT[] := ARRAY['stupid','hate','idiot','shut up','burro','idiota','cala','fuck','shit','damn','bitch','asshole','merda','caralho','puta','foda'];
  w TEXT;
  cleaned TEXT;
BEGIN
  IF NEW.content IS NULL THEN
    RAISE EXCEPTION 'Message content required';
  END IF;

  cleaned := NEW.content;
  IF length(cleaned) > 500 THEN
    cleaned := left(cleaned, 500);
  END IF;

  FOREACH w IN ARRAY banned LOOP
    cleaned := regexp_replace(cleaned, w, '***', 'gi');
  END LOOP;

  NEW.content := cleaned;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderate_community_message_trg ON public.community_messages;
CREATE TRIGGER moderate_community_message_trg
BEFORE INSERT ON public.community_messages
FOR EACH ROW EXECUTE FUNCTION public.moderate_community_message();
