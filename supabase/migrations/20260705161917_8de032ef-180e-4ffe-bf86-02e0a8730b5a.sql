
CREATE OR REPLACE FUNCTION public.admin_analytics(_days INT DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_students int;
  v_active_30 int;
  v_active_7 int;
  v_revenue_total bigint;
  v_revenue_month bigint;
  v_revenue_year bigint;
  v_avg_study_min numeric;
  v_completion numeric;
  v_dropout numeric;
  v_retention numeric;
  v_revenue_series jsonb;
  v_students_series jsonb;
  v_activity_series jsonb;
  v_plans jsonb;
  v_methods jsonb;
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_students FROM public.profiles;

  SELECT COUNT(DISTINCT user_id) INTO v_active_30
    FROM public.study_sessions WHERE day >= (CURRENT_DATE - 30);
  SELECT COUNT(DISTINCT user_id) INTO v_active_7
    FROM public.study_sessions WHERE day >= (CURRENT_DATE - 7);

  SELECT COALESCE(SUM(amount_kz),0) INTO v_revenue_total
    FROM public.payments WHERE status = 'paid';
  SELECT COALESCE(SUM(amount_kz),0) INTO v_revenue_month
    FROM public.payments WHERE status = 'paid'
      AND paid_at >= date_trunc('month', now());
  SELECT COALESCE(SUM(amount_kz),0) INTO v_revenue_year
    FROM public.payments WHERE status = 'paid'
      AND paid_at >= date_trunc('year', now());

  SELECT COALESCE(AVG(seconds),0)/60.0 INTO v_avg_study_min
    FROM public.study_sessions WHERE day >= (CURRENT_DATE - _days);

  SELECT
    CASE WHEN COUNT(*)=0 THEN 0
         ELSE (COUNT(*) FILTER (WHERE completed_at IS NOT NULL))::numeric * 100 / COUNT(*)
    END
  INTO v_completion FROM public.lesson_progress;

  v_dropout := GREATEST(0, 100 - COALESCE(v_completion,0));

  v_retention := CASE WHEN v_students = 0 THEN 0
                      ELSE v_active_30::numeric * 100 / v_students END;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.month) INTO v_revenue_series FROM (
    SELECT to_char(date_trunc('month', paid_at),'YYYY-MM') AS month,
           SUM(amount_kz)::bigint AS amount
    FROM public.payments
    WHERE status='paid' AND paid_at >= (now() - interval '12 months')
    GROUP BY 1
  ) t;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.month) INTO v_students_series FROM (
    SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month,
           COUNT(*)::int AS count
    FROM public.profiles
    WHERE created_at >= (now() - interval '12 months')
    GROUP BY 1
  ) t;

  SELECT jsonb_agg(row_to_json(t) ORDER BY t.day) INTO v_activity_series FROM (
    SELECT to_char(day,'YYYY-MM-DD') AS day,
           SUM(seconds)::bigint AS seconds,
           COUNT(DISTINCT user_id)::int AS users
    FROM public.study_sessions
    WHERE day >= (CURRENT_DATE - _days)
    GROUP BY day
  ) t;

  SELECT jsonb_agg(row_to_json(t)) INTO v_plans FROM (
    SELECT sp.name, sp.tier::text AS tier,
           COUNT(p.id)::int AS orders,
           COALESCE(SUM(p.amount_kz) FILTER (WHERE p.status='paid'),0)::bigint AS revenue
    FROM public.subscription_plans sp
    LEFT JOIN public.payments p ON p.plan_id = sp.id
    GROUP BY sp.id, sp.name, sp.tier
    ORDER BY revenue DESC
  ) t;

  SELECT jsonb_agg(row_to_json(t)) INTO v_methods FROM (
    SELECT COALESCE(method::text,'unknown') AS method,
           COUNT(*)::int AS count,
           COALESCE(SUM(amount_kz) FILTER (WHERE status='paid'),0)::bigint AS revenue
    FROM public.payments
    GROUP BY method
  ) t;

  v_result := jsonb_build_object(
    'students', v_students,
    'active_7', v_active_7,
    'active_30', v_active_30,
    'revenue_total', v_revenue_total,
    'revenue_month', v_revenue_month,
    'revenue_year', v_revenue_year,
    'avg_study_min', round(v_avg_study_min::numeric, 1),
    'completion_rate', round(COALESCE(v_completion,0)::numeric, 1),
    'dropout_rate', round(v_dropout::numeric, 1),
    'retention_rate', round(v_retention::numeric, 1),
    'revenue_series', COALESCE(v_revenue_series,'[]'::jsonb),
    'students_series', COALESCE(v_students_series,'[]'::jsonb),
    'activity_series', COALESCE(v_activity_series,'[]'::jsonb),
    'plans', COALESCE(v_plans,'[]'::jsonb),
    'methods', COALESCE(v_methods,'[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_analytics(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_analytics(INT) TO authenticated;
